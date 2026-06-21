#!/usr/bin/env node
// Stdio proxy in front of `electron-mcp-server`.
//
// Why this exists: electron-mcp-server@1.5.0 emits `exclusiveMinimum`/
// `exclusiveMaximum` as BOOLEANS (the JSON Schema draft-04 style). The Anthropic
// API validates tool schemas against draft 2020-12, where those keywords must be
// NUMBERS. Loading any affected tool makes every API call 400 with
// "tools.N.custom.input_schema: JSON schema is invalid" until the session restarts.
//
// This shim spawns the real server and pipes both directions through unchanged,
// except it rewrites the `tools/list` result so each schema is draft-2020-12 valid:
//   { minimum: M, exclusiveMinimum: true }  -> { exclusiveMinimum: M }   (x > M)
//   { exclusiveMinimum: false }             -> drop the key (minimum stays)
//   (same for maximum / exclusiveMaximum)
//
// Point the MCP config's command/args at this file. Everything else is transparent.

import { spawn } from 'node:child_process';

const child = spawn('npx', ['-y', 'electron-mcp-server', ...process.argv.slice(2)], {
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: true,
});

// Renderer/client -> server: raw passthrough.
process.stdin.pipe(child.stdin);
child.on('exit', (code) => process.exit(code ?? 0));

function fixExclusive(node) {
  if (Array.isArray(node)) {
    for (const item of node) fixExclusive(item);
    return;
  }
  if (!node || typeof node !== 'object') return;

  for (const [boundKey, exclKey] of [
    ['minimum', 'exclusiveMinimum'],
    ['maximum', 'exclusiveMaximum'],
  ]) {
    const excl = node[exclKey];
    if (excl === true) {
      // Boolean true: the sibling bound is exclusive. Move it onto the keyword.
      if (typeof node[boundKey] === 'number') {
        node[exclKey] = node[boundKey];
        delete node[boundKey];
      } else {
        // No numeric bound to attach to; a bare boolean is invalid, so drop it.
        delete node[exclKey];
      }
    } else if (excl === false) {
      // Boolean false is a no-op in draft-04; remove so 2020-12 stays valid.
      delete node[exclKey];
    }
  }

  for (const key of Object.keys(node)) {
    const v = node[key];
    if (v && typeof v === 'object') fixExclusive(v);
  }
}

// Server -> client: parse newline-delimited JSON-RPC, patch tools/list, re-emit.
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) {
      process.stdout.write(line + '\n');
      continue;
    }
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(line + '\n'); // not JSON we understand; pass through
      continue;
    }
    const tools = msg?.result?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (t && typeof t === 'object') {
          if (t.inputSchema) fixExclusive(t.inputSchema);
          if (t.outputSchema) fixExclusive(t.outputSchema);
        }
      }
      process.stdout.write(JSON.stringify(msg) + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
});
