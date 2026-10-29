// Run the material oracle for a set of heroes and views in headless Edge (real GPU).
//
// usage: node tools/material-oracle/run.mjs [--heroes abrams,haze] [--views front,back]
//        [--crops body,face] [--ours citadel|classic] [--out .codex-run/oracle/out] [--tag name]
//        [--url http://127.0.0.1:5191] (start tools/material-oracle/server.mjs first)
//
// Writes <out>/<tag>/<hero>_<view>_<crop>.{json,ref.png,ours.png,diff.png} and a
// summary.json with the pixel-weighted totals.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const heroes = option('--heroes', 'abrams,celeste,infernus,graves,mcginnis,wraith,haze,seven').split(',');
const views = option('--views', 'front').split(',');
const crops = option('--crops', 'body').split(',');
const ours = option('--ours', 'citadel');
const base = option('--url', 'http://127.0.0.1:5191');
const extra = option('--extra', '');
const tag = option('--tag', ours);
const out = join(option('--out', '.codex-run/oracle/out'), tag);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } });
page.on('console', (msg) => { if (msg.type() === 'error') console.error('[page]', msg.text().slice(0, 400)); });
const totals = { pixels: 0, sq: 0, abs: 0 };
const summary = {};
for (const hero of heroes) {
  for (const view of views) {
    for (const crop of crops) {
      const name = `${hero}_${view}_${crop}`;
      await page.goto(`${base}/tools/material-oracle/oracle.html?hero=${hero}&view=${view}&crop=${crop}&ours=${ours}${extra ? `&${extra}` : ''}`);
      await page.waitForFunction(() => window.__oracle, null, { timeout: 180000 });
      const result = await page.evaluate(() => window.__oracle);
      if (result.error) { console.error(name, result.error); continue; }
      for (const [label, url] of Object.entries(result.images)) {
        writeFileSync(join(out, `${name}.${label}.png`), Buffer.from(url.split(',')[1], 'base64'));
      }
      delete result.images;
      writeFileSync(join(out, `${name}.json`), JSON.stringify(result, null, 1));
      summary[name] = result.total;
      totals.pixels += result.total.pixels;
      totals.sq += result.total.rmse8 ** 2 * result.total.pixels;
      totals.abs += result.total.mae8 * result.total.pixels;
      console.log(name.padEnd(28), JSON.stringify(result.total));
    }
  }
}
const overall = { pixels: totals.pixels, rmse8: +Math.sqrt(totals.sq / Math.max(1, totals.pixels)).toFixed(2), mae8: +(totals.abs / Math.max(1, totals.pixels)).toFixed(2) };
console.log('OVERALL'.padEnd(28), JSON.stringify(overall));
writeFileSync(join(out, 'summary.json'), JSON.stringify({ overall, cases: summary }, null, 1));
await browser.close();
