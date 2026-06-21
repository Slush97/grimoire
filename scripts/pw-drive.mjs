// Playwright-over-CDP driver for the running Grimoire dev app.
//
// Successor to cdp-drive.mjs: attaches to the renderer the same way (CDP on
// port 9222) but exposes Playwright's auto-waiting locators, real screenshots,
// and role/text queries. Runs as a plain script, so unlike the electron-mcp
// server it has NO tool schema that can poison a Claude session.
//
// Prereqs:
//   1. `pnpm dev` running (the app launches with --remote-debugging-port=9222,
//      which electron/main/index.ts enables only in dev).
//   2. playwright-core installed (devDependency).
//
// Usage:
//   node scripts/pw-drive.mjs targets                 list CDP page targets
//   node scripts/pw-drive.mjs goto locker             set hash route to #/locker
//   node scripts/pw-drive.mjs eval "<js expression>"  eval in renderer, JSON result
//   node scripts/pw-drive.mjs shot <out.png>          screenshot (full page)
//   node scripts/pw-drive.mjs click "<selector>"      click (CSS or text=…/role=…)
//   node scripts/pw-drive.mjs text "<selector>"       innerText of first match
//   node scripts/pw-drive.mjs title                   page title + url
//
// Selectors accept Playwright syntax: "button.foo", "text=Dynamo",
// "role=button[name=Apply]", etc. Routes for `goto`: locker, browse, discover,
// servers, conflicts, profiles, crosshair, autoexec, stats, settings, or "" for
// the Installed home page.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const PORT = process.env.REMOTE_DEBUGGING_PORT || '9222';
const [action, arg] = process.argv.slice(2);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch((e) => {
  fail(
    `Could not attach to CDP on port ${PORT}: ${e.message}\n` +
      'Is `pnpm dev` running? The debug port is dev-only (electron/main/index.ts).'
  );
});

const contexts = browser.contexts();
const pages = contexts.flatMap((c) => c.pages());
// The app window is the page served from the vite dev server (5173); fall back
// to the first non-devtools page.
const page =
  pages.find((p) => /5173/.test(p.url())) ||
  pages.find((p) => !/devtools:/.test(p.url())) ||
  pages[0];

if (action === 'targets') {
  console.log(JSON.stringify(pages.map((p) => ({ url: p.url(), title: undefined })), null, 2));
  await browser.close();
  process.exit(0);
}

if (!page) fail('No app page target found. Is the app window open?');

try {
  switch (action) {
    case 'goto': {
      const route = (arg || '').replace(/^#?\/?/, '');
      await page.evaluate((r) => {
        window.location.hash = '#/' + r;
      }, route);
      await page.waitForTimeout(150);
      console.log('hash -> ' + (await page.evaluate(() => window.location.hash)));
      break;
    }
    case 'eval': {
      if (!arg) fail('eval needs a JS expression');
      const value = await page.evaluate((expr) => {
        // Indirect eval so the expression runs in global scope.
        return Promise.resolve((0, eval)(expr));
      }, arg);
      console.log(JSON.stringify(value));
      break;
    }
    case 'shot': {
      if (!arg) fail('shot needs an output path');
      await page.screenshot({ path: arg, fullPage: true });
      console.log('wrote ' + arg);
      break;
    }
    case 'click': {
      if (!arg) fail('click needs a selector');
      await page.locator(arg).first().click({ timeout: 10000 });
      console.log('clicked ' + arg);
      break;
    }
    case 'text': {
      if (!arg) fail('text needs a selector');
      console.log(await page.locator(arg).first().innerText({ timeout: 10000 }));
      break;
    }
    case 'title': {
      console.log(JSON.stringify({ title: await page.title(), url: page.url() }));
      break;
    }
    default:
      fail('unknown action: ' + action);
  }
} finally {
  // Detach without closing the app: connectOverCDP owns only the connection.
  await browser.close();
}
process.exit(0);
