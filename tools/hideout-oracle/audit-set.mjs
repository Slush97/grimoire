// Audits the largest source aggregates without modifying either export.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [map, sceneDirectory] = process.argv.slice(2);
if (!map || !sceneDirectory) throw new Error('Expected installed map.vpk isolated-scene-directory');
const node = JSON.parse(readFileSync('.codex-run/hideout-data/node.json'));
const bundled=process.argv.includes('--bundle');
let bundle=null;
if(bundled){
  const bytes=readFileSync(join(sceneDirectory,'models.glb'));
  bundle=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
}
function modelWeight(file){
  if(!bundle)return statSync(join(sceneDirectory,file)).size;
  const root=bundle.nodes.find(node=>node.extras?.hideoutModel===file);
  if(!root)throw new Error(`Missing bundled model ${file}`);
  let indices=0;
  function visit(node){
    if(node.mesh!==undefined)for(const p of bundle.meshes[node.mesh].primitives)indices+=bundle.accessors[p.indices].count;
    for(const child of node.children??[])visit(bundle.nodes[child]);
  }
  visit(root);return indices;
}
const models = [...node.m_sceneObjects, ...node.m_aggregateSceneObjects]
  .filter(o => o.m_renderableModel.includes('agg_merge'))
  .map(o => {
    const file = createHash('sha256').update(o.m_renderableModel + '_c').digest('hex').slice(0, 24) + '.glb';
    return { model: o.m_renderableModel, file, weight: modelWeight(file) };
  }).sort((a, b) => b.weight - a.weight);
const previous = bundled && existsSync('.codex-run/hideout-data/geometry-audit-fixed.json')
  ? new Set(JSON.parse(readFileSync('.codex-run/hideout-data/geometry-audit-fixed.json')).map(row=>row.model)) : new Set();
const selected = models.filter((o, i) => i < 7 || previous.has(o.model) || /hideout_vertex_color_[012]|hideout_sidetable|wood_varnished_trim/.test(o.model));
const results = [];
for (const model of selected) {
  const reference = join('.codex-run/hideout-data', `vrf-${model.file}`);
  if (!existsSync(reference) || !existsSync(reference + '.draws.json')) {
    execFileSync(resolve('.codex-run/hideout-oracle/bin/Release/net10.0/Source2Viewer.exe'),
      ['--export-mesh', map, model.model, reference], { stdio: 'inherit', windowsHide: true });
  }
  const output = join('.codex-run/hideout-data', `audit-${bundled?'prepared-':''}${basename(model.file, '.glb')}.json`);
  execFileSync(process.execPath, ['tools/hideout-oracle/audit.mjs', reference, join(sceneDirectory, bundled?'models.glb':model.file), output,...(bundled?[model.file]:[])], { windowsHide: true });
  const { draws, ...audit } = JSON.parse(readFileSync(output));
  results.push({ model: model.model, ...audit });
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(`.codex-run/hideout-data/geometry-audit-${bundled?'prepared':'fixed'}.json`, JSON.stringify(results, null, 2));
if (results.some(r => r.mismatches)) throw new Error('Geometry audit failed');
