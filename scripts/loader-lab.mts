/*
 * loader-lab.mts
 * Builds one standalone page that plays the 3D previews' loader (PreviewLoader) on a loop, with
 * controls for its size, progress, screen programs and layers. The page carries the real component's
 * markup and the real styles from src/index.css, with the layers inlined, so what is tuned there is
 * what the app shows. Open the file in any browser.
 *
 *   pnpm exec tsx --tsconfig tsconfig.app.json scripts/loader-lab.mts [out.html]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewLoader } from '../src/components/common/PreviewLoader.tsx';
import { PHRASES, type ScreenProgram } from '../src/components/common/previewLoaderArt.ts';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = resolve(process.argv[2] ?? resolve(root, 'loader-lab.html'));

/** The loader's own block of index.css, from its comment to the next component's. */
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
const from = css.indexOf('/* Preview loader (common/PreviewLoader.tsx)');
const to = css.indexOf('/* Skeletons (common/Skeleton.tsx)');
if (from < 0 || to < from) throw new Error('The loader styles were not found in src/index.css.');
const styles = css.slice(from, to);
/** The size the loader ships with, as the size controls' starting point. */
const [, floor = '300', share = '46'] = /--loader-width: .*max\((\d+)px, (\d+)cqmin\)/.exec(styles) ?? [];

/** The images the markup points at, kept once and put back in by the page: name to data URL. */
const images: Record<string, string> = {};
const keep = (path: string, type: string): string => {
  const name = path.replace(/^.*[\\/]/, '').replace(/\W+/g, '_');
  images[name] ??= `data:image/${type};base64,${readFileSync(path).toString('base64')}`;
  return `@@${name}@@`;
};
/** The component's markup for one phrase and program, with each image's URL replaced by a name. */
function markup(phrase: number, program: ScreenProgram, progress?: number): string {
  const html = renderToStaticMarkup(createElement(PreviewLoader, { program, progress, phrase, hero: 'Abrams' }));
  return html
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/file:\/\/[^"]+\.webp/g, (url) => keep(fileURLToPath(url), 'webp'))
    .replace(/src="(\/heroes\/[^"]+\.png)"/g, (_, path: string) => `src="${keep(resolve(root, 'public', `.${path}`), 'png')}"`);
}
const screenOf = (html: string) => {
  const screen = /<div class="preview-loader__screen"[^>]*>([\s\S]*?)<\/div><div class="preview-loader__steam"/.exec(html)?.[1];
  if (!screen) throw new Error('The loader\'s screen was not found in its markup.');
  return screen;
};
const programs: ScreenProgram[] = ['hero', 'book', 'type'];
/** One loader per phrase (its keys and keyframes differ), and every program's screen. `type` has one per phrase. */
const loaders = PHRASES.map((_, phrase) => markup(phrase, 'type'));
const screens = Object.fromEntries(programs.map((program) => [program, screenOf(markup(0, program))]));
const typed = loaders.map(screenOf);

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loader lab</title>
<style>
:root { --color-accent: #f97316; --color-hl: #ffffff; --stage: #1a1a1a; --page: #0f0f0f; --ink: #e5e5e5; --dim: #9a9aa2; --line: #2d2d2d; }
:root[data-theme="oled"] { --stage: #080808; --page: #000000; --line: #242424; }
:root[data-theme="light"] { --color-hl: #1c1b19; --stage: #faf9f6; --page: #f1efea; --ink: #1c1b19; --dim: #57544e; --line: #d6d2c8; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; background: var(--page); color: var(--ink); font: 13px/1.4 system-ui, sans-serif; }
@media (max-width: 760px) { body { grid-template-columns: 1fr; grid-template-rows: minmax(360px, 1fr) auto; } }
main { min-width: 0; min-height: 0; display: grid; place-items: center; padding: 16px; overflow: auto; }
#stage { position: relative; width: 900px; height: 640px; max-width: 100%; max-height: 100%; resize: both; overflow: hidden; background: var(--stage); border: 1px solid var(--line); border-radius: 4px; }
aside { overflow: auto; padding: 14px 16px 24px; border-left: 1px solid var(--line); }
h1 { margin: 0 0 2px; font-size: 15px; }
h2 { margin: 16px 0 6px; font-size: 12px; font-weight: 600; color: var(--dim); }
p { margin: 0 0 8px; color: var(--dim); }
label { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
label > span:first-child { flex: 1; }
input[type="range"] { width: 130px; }
output { width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: var(--dim); }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
button { padding: 5px 9px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button[aria-pressed="true"] { border-color: var(--color-accent); color: var(--color-accent); }
code { display: block; margin-top: 6px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--dim); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
${styles}
/* Lab only: layers switched off, and speeds set from the controls. */
#stage[data-off~="light"] .preview-loader__screenlight,
#stage[data-off~="rays"] .preview-loader__rays,
#stage[data-off~="glow"] .preview-loader__glow,
#stage[data-off~="steam"] .preview-loader__steam,
#stage[data-off~="planchette"] .preview-loader__planchette,
#stage[data-off~="fan"] .preview-loader__seat,
#stage[data-off~="status"] .preview-loader__status,
#stage[data-off~="screen"] .preview-loader__screen { display: none; }
#stage[data-off~="keys"] .preview-loader__keys > i { animation: none !important; }
#stage .preview-loader__fan { animation-duration: var(--lab-fan, 0.64s); }
#stage .preview-loader__planchette { animation-delay: var(--lab-planchette, 5s); }
</style>
<main><div id="stage"></div></main>
<aside>
  <h1>Loader lab</h1>
  <p>The app's loader, looping. Drag the corner of the box to resize it.</p>

  <h2>Window</h2>
  <div class="row" id="sizes">
    <button data-size="320,360">Installed peek</button>
    <button data-size="900,640" aria-pressed="true">Locker panel</button>
    <button data-size="1400,820">Door Stuck</button>
    <button data-size="140,120">Tiny</button>
  </div>

  <h2>Size of the scene</h2>
  <label><span>Share of a big window</span><input id="share" type="range" min="20" max="76" value="${share}"><output></output></label>
  <label><span>Smallest, px</span><input id="floor" type="range" min="160" max="520" step="10" value="${floor}"><output></output></label>
  <code id="width"></code>

  <h2>Progress</h2>
  <div class="row" id="progress">
    <button data-mode="none" aria-pressed="true">Unknown</button>
    <button data-mode="auto">Filling</button>
    <button data-mode="fixed">Fixed</button>
  </div>
  <label><span>Fixed at</span><input id="amount" type="range" min="0" max="100" value="40"><output></output></label>

  <h2>Screen</h2>
  <div class="row" id="programs">
    <button data-program="auto" aria-pressed="true">In turn</button>
    ${programs.map((program) => `<button data-program="${program}">${program}</button>`).join('')}
  </div>

  <h2>Typing</h2>
  <div class="row" id="phrases">
    ${PHRASES.map((phrase, index) => `<button data-phrase="${index}"${index ? '' : ' aria-pressed="true"'}>${phrase}</button>`).join('')}
  </div>
  <p style="margin-top:6px">The keys type the phrase whatever the screen shows. The screen spells it in <b>type</b>.</p>

  <h2>Parts</h2>
  <div class="row" id="parts">
    ${[['light', 'Screen light'], ['rays', 'Rays'], ['glow', 'Glow'], ['steam', 'Steam'], ['planchette', 'Planchette'], ['keys', 'Typing'], ['fan', 'Fan'], ['screen', 'Screen marks'], ['status', 'Line']]
      .map(([key, name]) => `<button data-part="${key}" aria-pressed="true">${name}</button>`).join('')}
  </div>
  <label><span>Fan, seconds a turn</span><input id="fan" type="range" min="0.2" max="3" step="0.02" value="0.64"><output></output></label>
  <label><span>Planchette starts after, s</span><input id="planchette" type="range" min="0" max="20" step="1" value="5"><output></output></label>

  <h2>Look</h2>
  <div class="row" id="themes">
    <button data-theme="dark" aria-pressed="true">Dark</button>
    <button data-theme="oled">OLED</button>
    <button data-theme="light">Light</button>
  </div>
  <label><span>Accent</span><input id="accent" type="color" value="#f97316"></label>

  <h2>Try</h2>
  <div class="row">
    <button id="replay">Replay from the start</button>
    <button id="stall">Freeze the page for 3 s</button>
  </div>
  <p style="margin-top:8px">The freeze blocks scripts and layout, as a model load does. The fan, the light and the line should keep moving through it.</p>
</aside>
<script>
const IMAGES = ${JSON.stringify(images)};
const withImages = (html) => html.replace(/@@([A-Za-z0-9_]+)@@/g, (_, name) => IMAGES[name]);
const LOADERS = ${JSON.stringify(loaders)}.map(withImages);
const SCREENS = Object.fromEntries(Object.entries(${JSON.stringify(screens)}).map(([program, html]) => [program, withImages(html)]));
const TYPED = ${JSON.stringify(typed)};
const PROGRAMS = ${JSON.stringify(programs)};
const stage = document.getElementById('stage');
const state = { mode: 'none', amount: 0.4, program: 'auto', phrase: 0, turn: 0, started: performance.now() };
// #program=book opens on one program, to link to it.
const asked = new URLSearchParams(location.hash.slice(1)).get('program');
if (asked && SCREENS[asked]) {
  state.program = asked;
  for (const button of document.getElementById('programs').children) button.setAttribute('aria-pressed', String(button.dataset.program === asked));
}

function mount() {
  stage.innerHTML = LOADERS[state.phrase];
  state.started = performance.now();
  if (state.program === 'auto') state.turn++;
  draw();
}
function amount() {
  if (state.mode === 'fixed') return state.amount;
  if (state.mode === 'auto') return ((performance.now() - state.started) / 12000) % 1;
  return null;
}
let screenShown = '';
function draw() {
  const value = amount(), known = value !== null;
  const program = state.program !== 'auto' ? state.program : PROGRAMS[state.turn % PROGRAMS.length];
  const screen = stage.querySelector('.preview-loader__screen');
  if (!screen) return;
  if (screen.dataset.program !== program) { screen.innerHTML = program === 'type' ? TYPED[state.phrase] : SCREENS[program]; screen.dataset.program = program; }
  const status = stage.querySelector('.preview-loader__status');
  status.classList.toggle('preview-loader__status--sweep', !known);
  status.firstElementChild.style.transform = known ? 'scaleX(' + value + ')' : '';
}
setInterval(draw, 200);

const pick = (group, attribute, apply) => document.getElementById(group).addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  for (const other of button.parentElement.children) other.setAttribute('aria-pressed', String(other === button));
  apply(button.getAttribute(attribute));
});
pick('sizes', 'data-size', (size) => { const [width, height] = size.split(','); stage.style.width = width + 'px'; stage.style.height = height + 'px'; });
pick('progress', 'data-mode', (mode) => { state.mode = mode; state.started = performance.now(); draw(); });
pick('programs', 'data-program', (program) => { state.program = program; draw(); });
pick('phrases', 'data-phrase', (phrase) => { state.phrase = Number(phrase); mount(); });
pick('themes', 'data-theme', (theme) => { document.documentElement.dataset.theme = theme; });
document.getElementById('parts').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  stage.dataset.off = [...button.parentElement.children].filter((part) => part.getAttribute('aria-pressed') !== 'true').map((part) => part.dataset.part).join(' ');
});

const slider = (id, apply) => {
  const input = document.getElementById(id), output = input.nextElementSibling;
  const update = () => { if (output) output.textContent = input.value; apply(Number(input.value)); };
  input.addEventListener('input', update);
  update();
};
const width = () => {
  const value = 'min(76cqw, 78cqh, max(' + document.getElementById('floor').value + 'px, ' + document.getElementById('share').value + 'cqmin))';
  stage.style.setProperty('--lab-width', value);
  document.getElementById('width').textContent = '--loader-width: ' + value + ';';
};
slider('share', width);
slider('floor', width);
slider('amount', (value) => { state.amount = value / 100; draw(); });
slider('fan', (value) => stage.style.setProperty('--lab-fan', value + 's'));
slider('planchette', (value) => stage.style.setProperty('--lab-planchette', value + 's'));
document.getElementById('accent').addEventListener('input', (event) => document.documentElement.style.setProperty('--color-accent', event.target.value));
document.getElementById('replay').addEventListener('click', mount);
document.getElementById('stall').addEventListener('click', () => { const until = performance.now() + 3000; while (performance.now() < until) { /* busy */ } });
mount();
</script>
</html>
`;

// The size controls set a variable the loader reads in the lab instead of its own.
writeFileSync(out, page.replace(/--loader-width: ([^;]+);/, '--loader-width: var(--lab-width, $1);'));
console.log(`Wrote ${out} (${Math.round(page.length / 1024)} KB)`);
