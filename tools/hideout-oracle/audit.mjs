// Compares exported index streams to VRF. Never repairs or substitutes game data.
import { readFileSync, writeFileSync } from 'node:fs';
function readGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`Invalid GLB: ${path}`);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  const binary = bytes.subarray(28 + length);
  function accessor(index) {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
    if (!size || !width || !read) throw new Error('Unsupported accessor');
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return { count: a.count, get: (i, c = 0) => binary[read](start + i * (view.byteStride ?? size * width) + c * width) };
  }
  return { json, accessor };
}
const [referencePath, actualPath, outputPath, actualModel] = process.argv.slice(2);
if (!referencePath || !actualPath || !outputPath) throw new Error('Expected reference.glb actual.glb output.json');
const reference = readGlb(referencePath), actual = readGlb(actualPath);
function modelPrimitives(document, name) {
  const root=document.nodes.findIndex(node=>node.extras?.hideoutModel===name);
  if(root<0)throw new Error(`Missing bundled model ${name}`);
  const primitives=[];
  const walk=index=>{
    const node=document.nodes[index];
    if(node.mesh!==undefined)primitives.push(...document.meshes[node.mesh].primitives);
    for(const child of node.children??[])walk(child);
  };
  walk(root);
  return primitives;
}
const expected = reference.json.meshes[0].primitives, observed = actualModel ? modelPrimitives(actual.json, actualModel) : actual.json.meshes[0].primitives;
if (expected.length !== observed.length) throw new Error('Primitive count differs');
const draws = JSON.parse(readFileSync(referencePath + '.draws.json'));
const checkedPositions = new Set();
let maxPositionComponentErrorMeters = 0;
const primitives = expected.map((primitive, i) => {
  const theirs = reference.accessor(primitive.indices), ours = actual.accessor(observed[i].indices);
  if (theirs.count !== ours.count) throw new Error(`Index count differs in primitive ${i}`);
  let mismatches = 0, first = null, minDelta = Infinity, maxDelta = -Infinity;
  for (let index = 0; index < theirs.count; index++) {
    const correct = theirs.get(index), exported = ours.get(index), delta = exported - correct;
    minDelta = Math.min(minDelta, delta); maxDelta = Math.max(maxDelta, delta);
    if (correct !== exported) { mismatches++; first ??= { index, correct, exported }; }
  }
  const pair = `${primitive.attributes.POSITION}:${observed[i].attributes.POSITION}`;
  if (!checkedPositions.has(pair)) {
    checkedPositions.add(pair);
    const a = reference.accessor(primitive.attributes.POSITION), b = actual.accessor(observed[i].attributes.POSITION);
    if (a.count !== b.count) throw new Error(`Vertex count differs in primitive ${i}`);
    for (let v = 0; v < a.count; v++) for (let c = 0; c < 3; c++) {
      // VRF bakes the basis; morphic puts it on the GLB root node.
      const error = Math.abs(a.get(v, c) - b.get(v, [1, 2, 0][c]) * 0.0254);
      maxPositionComponentErrorMeters = Math.max(maxPositionComponentErrorMeters, error);
    }
  }
  return { primitive: i, indices: theirs.count, mismatches, first, minDelta, maxDelta, ...draws[i] };
});
const result = { referencePath, actualPath, ...(actualModel?{actualModel}:{}), maxPositionComponentErrorMeters,
  primitives: primitives.length, brokenPrimitives: primitives.filter(p => p.mismatches).length,
  indices: primitives.reduce((n, p) => n + p.indices, 0), mismatches: primitives.reduce((n, p) => n + p.mismatches, 0), draws: primitives };
writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, draws: result.draws.filter(p => [0, 1, 17, 21].includes(p.primitive)) }, null, 2));
