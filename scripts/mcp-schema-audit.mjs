// Dump a stdio MCP server's tool schemas and validate each against JSON Schema
// draft 2020-12 (the dialect the Anthropic API enforces). Prints any tool whose
// inputSchema Ajv refuses to compile under 2020-12 strict mode.
//
//   node scripts/mcp-schema-audit.mjs                 # audit raw electron-mcp-server
//   node scripts/mcp-schema-audit.mjs shim            # audit through the shim
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const NPX_AJV = 'C:/Users/USER/AppData/Local/npm-cache/_npx/02f857227ffe4bdc/node_modules';
const require = createRequire(NPX_AJV + '/');
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats');

const useShim = process.argv[2] === 'shim';
const cmd = useShim
  ? { command: 'node', args: ['scripts/electron-mcp-shim.mjs'] }
  : { command: 'npx', args: ['-y', 'electron-mcp-server'] };

const child = spawn(cmd.command, cmd.args, { stdio: ['pipe', 'pipe', 'inherit'], shell: true });

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'schema-audit', version: '0.0.0' },
});
notify('notifications/initialized', {});
const res = await rpc('tools/list', {});
const tools = res.result?.tools || [];

console.log(`[${useShim ? 'shim' : 'raw'}] Got ${tools.length} tools\n`);

const bad = [];
tools.forEach((t, idx) => {
  try {
    const a = new Ajv2020({ strict: true, allErrors: true });
    try { addFormats(a); } catch {}
    a.compile(t.inputSchema);
  } catch (e) {
    bad.push({ idx, name: t.name, err: e.message, schema: t.inputSchema });
  }
});

if (!bad.length) {
  console.log('All schemas compiled clean under strict draft 2020-12.');
} else {
  console.log(`${bad.length} tool(s) FAILED strict 2020-12 compile:\n`);
  for (const b of bad) {
    console.log(`#${b.idx} ${b.name}`);
    console.log('  ERROR: ' + b.err);
    console.log('  SCHEMA: ' + JSON.stringify(b.schema));
    console.log();
  }
}

child.kill();
process.exit(0);
