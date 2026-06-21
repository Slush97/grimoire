// Minimal Chrome DevTools Protocol driver for the running Electron app.
// Uses Node's built-in fetch + WebSocket (Node 22+). No external deps.
//
// Usage:
//   node scripts/cdp-drive.mjs targets
//   node scripts/cdp-drive.mjs eval "<js expression>"
//   node scripts/cdp-drive.mjs shot <output.png>
//
// The eval expression runs in the renderer page context; its value is returned
// by value (JSON). shot captures a full-page PNG screenshot.

const PORT = process.env.REMOTE_DEBUGGING_PORT || '9222';
const action = process.argv[2];
const arg = process.argv[3];

async function pickPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await res.json();
  // The app window is a "page" target served from the vite dev server.
  const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const app =
    pages.find((t) => /5173/.test(t.url)) ||
    pages.find((t) => !/devtools:/.test(t.url)) ||
    pages[0];
  if (!app) throw new Error('No page target found on CDP port ' + PORT);
  return app;
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || e.type))));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

const target = await pickPageTarget();

if (action === 'targets') {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await res.json();
  console.log(
    JSON.stringify(
      list.map((t) => ({ type: t.type, title: t.title, url: t.url })),
      null,
      2
    )
  );
  process.exit(0);
}

const client = cdp(target.webSocketDebuggerUrl);
await client.ready;

if (action === 'eval') {
  const result = await client.send('Runtime.evaluate', {
    expression: arg,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails));
    process.exit(1);
  }
  console.log(JSON.stringify(result.result.value));
} else if (action === 'shot') {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const fs = await import('node:fs');
  fs.writeFileSync(arg, Buffer.from(result.data, 'base64'));
  console.log('wrote ' + arg);
} else {
  console.error('unknown action: ' + action);
  process.exit(1);
}

client.close();
process.exit(0);
