// Inventory the Source 2 material state carried by cached hero GLBs.
// Usage: node tools/material-oracle/inventory.mjs [heroCacheRoot] [outJson]
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || path.join(process.env.APPDATA ?? '', 'grimoire', 'hero-poses');
const out = process.argv[3];

function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const rows = [];
for (const dir of fs.readdirSync(root).filter((d) => d.endsWith('_vanilla'))) {
  const file = path.join(root, dir, 'model-rigged.glb');
  if (!fs.existsSync(file)) continue;
  const gltf = readGlbJson(file);
  // Triangle count per material is a cheap stand-in for screen coverage.
  const tris = new Map();
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.material === undefined) continue;
      const acc = gltf.accessors[prim.indices ?? prim.attributes.POSITION];
      tris.set(prim.material, (tris.get(prim.material) ?? 0) + Math.floor(acc.count / 3));
    }
  }
  (gltf.materials ?? []).forEach((m, i) => {
    const mo = m.extras?.morphic;
    if (!mo) return;
    const flags = Object.entries(mo.ints ?? {})
      .filter(([k, v]) => k.startsWith('F_') && Number(v) !== 0)
      .map(([k, v]) => (Number(v) === 1 ? k : `${k}=${v}`))
      .sort();
    rows.push({
      hero: dir.replace(/_vanilla$/, ''),
      name: m.name,
      shader: mo.shader,
      blend: mo.blend_mode,
      flags,
      tris: tris.get(i) ?? 0,
      textures: Object.keys(mo.texture_slots ?? mo.textures ?? {}).sort(),
      ints: mo.ints,
      floats: mo.floats,
      vectors: mo.vectors,
      dynamic: Object.keys(mo.dynamic_params ?? {}),
    });
  });
}

if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
const total = rows.reduce((s, r) => s + r.tris, 0);
const variants = new Map();
for (const r of rows) {
  const key = `${r.shader} | ${r.flags.join(',')}`;
  const v = variants.get(key) ?? { tris: 0, mats: 0, heroes: new Set() };
  v.tris += r.tris; v.mats += 1; v.heroes.add(r.hero);
  variants.set(key, v);
}
const sorted = [...variants.entries()].sort((a, b) => b[1].tris - a[1].tris);
let cum = 0;
console.log(`heroes=${new Set(rows.map((r) => r.hero)).size} materials=${rows.length} tris=${total}`);
for (const [k, v] of sorted) {
  cum += v.tris;
  console.log(`${(100 * v.tris / total).toFixed(1).padStart(5)}% cum ${(100 * cum / total).toFixed(1).padStart(5)}%  mats=${String(v.mats).padStart(3)} heroes=${String(v.heroes.size).padStart(2)}  ${k}`);
}
