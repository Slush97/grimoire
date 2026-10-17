/*
 * cdp.mjs
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
 * Lifted from scripts/guide-shots/cdp.mjs, trimmed to what QA needs.
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(port, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let target;
  while (!target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    } catch {
      // The debugger port is not up yet.
    }
    if (!target) {
      if (Date.now() > deadline) throw new Error(`no page target on port ${port}`);
      await sleep(250);
    }
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP websocket failed to open'));
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  // A crashed renderer or a dropped socket never answers; fail every waiting
  // call instead of hanging the run (and the agent driving it) forever.
  let dead = null;
  const failAll = (reason) => {
    dead = reason;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`${p.method}: ${reason}`));
    }
    pending.clear();
  };
  ws.onclose = () => failAll('CDP connection closed (did the app exit?)');
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === 'Inspector.targetCrashed') failAll('the renderer crashed');
      if (msg.method === 'Inspector.detached') failAll(`detached from the page (${msg.params?.reason})`);
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  };

  const send = (method, params = {}, { timeoutMs = 90_000 } = {}) =>
    new Promise((resolve, reject) => {
      if (dead) return reject(new Error(`${method}: ${dead}`));
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no reply in ${timeoutMs / 1000}s (renderer hung?)`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, method, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };

  return { send, on, close: () => ws.close() };
}

export class Page {
  constructor(cdp, { width = 1280, height = 800 } = {}) {
    this.cdp = cdp;
    this.width = width;
    this.height = height;
  }

  async init(instrumentation) {
    const { send } = this.cdp;
    await send('Inspector.enable');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Performance.enable', { timeDomain: 'timeTicks' });
    await send('Emulation.setDeviceMetricsOverride', {
      width: this.width,
      height: this.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (instrumentation) await send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
  }

  async eval(expression) {
    const res = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text);
    }
    return res.result.value;
  }

  /** Run `fn(...args)` in the page. `fn` must be self-contained. */
  call(fn, ...args) {
    return this.eval(`(${fn})(...${JSON.stringify(args)})`);
  }

  async waitFor(fn, { timeoutMs = 15_000, what = 'condition', args = [] } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.call(fn, ...args).catch(() => false)) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  }

  async reload() {
    const loaded = new Promise((r) => this.cdp.on('Page.loadEventFired', r));
    await this.cdp.send('Page.reload', { ignoreCache: false });
    await loaded;
  }

  async metrics() {
    const { metrics } = await this.cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  }

  async gc() {
    await this.cdp.send('HeapProfiler.enable');
    await this.cdp.send('HeapProfiler.collectGarbage');
  }

  async mouse(type, x, y, extra = {}) {
    await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
  }

  async key(key) {
    const keyCodes = { Escape: 27 };
    const base = { key, code: key, windowsVirtualKeyCode: keyCodes[key] };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async screenshot() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }
}
