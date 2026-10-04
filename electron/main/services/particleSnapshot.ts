export interface ParticleSnapshotPoint {
  position: [number, number, number]; joints: string[]; weights: number[];
}

/** Read Source 2's bounded SNAP BlockCompress stream and its DATA layout.
 * Positions remain in authored coordinates; export does not reinterpret skinning. */
export function readParticleSnapshot(bytes: Buffer, metadata: unknown): ParticleSnapshotPoint[] {
  const d = metadata as { num_particles?: number; attributes?: Array<{ name?: string; type?: string; data_offset?: number; data_size?: number }>; string_list?: string[] };
  const count = d?.num_particles;
  if (!Number.isSafeInteger(count) || !count || count < 0 || count > 256 || !Array.isArray(d.attributes)
    || d.attributes.length > 32 || !Array.isArray(d.string_list) || d.string_list.length > 4096
    || !d.string_list.every((s) => typeof s === 'string' && s.length <= 128)) throw new Error('Invalid particle snapshot metadata.');
  const check = (offset: number, length: number, limit = bytes.length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset+length > limit) throw new Error('Invalid particle snapshot bounds.');
  };
  check(0, 16);
  if (bytes.readUInt16LE(4) !== 12) throw new Error('Unsupported particle snapshot resource.');
  const table = 8+bytes.readInt32LE(8), blocks = bytes.readUInt32LE(12);
  if (blocks > 64) throw new Error('Particle snapshot block budget exceeded.');
  check(table, blocks*12);
  let compressed: Buffer | undefined;
  for (let i = 0; i < blocks; i++) {
    const header = table+i*12;
    if (bytes.toString('ascii', header, header+4) !== 'SNAP') continue;
    const offset = header+4+bytes.readInt32LE(header+4), length = bytes.readUInt32LE(header+8);
    check(offset, length); compressed = bytes.subarray(offset, offset+length); break;
  }
  if (!compressed || compressed.length < 4) throw new Error('Particle snapshot stream is absent.');
  const header = compressed.readUInt32LE(0), size = header & 0x7fffffff;
  if (size > 1024*1024) throw new Error('Particle snapshot stream budget exceeded.');
  const output = Buffer.alloc(size);
  let input = 4, write = 0, mask = 0, bits = 0;
  const read = (n: number) => { check(input, n, compressed!.length); const old = input; input += n; return old; };
  if (header & 0x80000000) compressed.copy(output, 0, read(size), input);
  else while (write < size) {
    if (!bits) { mask = compressed.readUInt16LE(read(2)); bits = 16; }
    if (mask & 1) {
      const token = compressed.readUInt16LE(read(2)), distance = (token >>> 4)+1, length = (token & 15)+3;
      if (distance > write || write+length > size) throw new Error('Invalid particle snapshot back-reference.');
      for (let i = 0; i < length; i++, write++) output[write] = output[write-distance];
    } else output[write++] = compressed[read(1)];
    mask >>>= 1; bits--;
  }
  const position = d.attributes.find((a) => a.name === 'position' && a.type === 'float3');
  const skinning = d.attributes.find((a) => a.name === 'skinning' && a.type === 'skinning');
  if (!position || !skinning) throw new Error('Unsupported particle snapshot attributes.');
  const base = (attribute: typeof position, stride: number) => {
    const offset = attribute.data_offset ?? -1;
    if (attribute.data_size !== count*stride) throw new Error('Invalid particle snapshot attribute size.');
    check(offset, count*stride, size); return offset;
  };
  const positions = base(position, 12), skins = base(skinning, 24);
  return Array.from({ length: count }, (_, i) => {
    const position = [0, 1, 2].map((k) => output.readFloatLE(positions+i*12+k*4)) as [number, number, number];
    const joints = [0, 1, 2, 3].map((k) => {
      const index = output.readInt16LE(skins+i*24+k*2);
      if (index < 0 || index >= d.string_list!.length) throw new Error('Invalid particle snapshot joint index.');
      return d.string_list![index];
    });
    const weights = [0, 1, 2, 3].map((k) => output.readFloatLE(skins+i*24+8+k*4));
    if (!position.every(Number.isFinite) || !weights.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
      || Math.abs(weights.reduce((a, b) => a+b, 0)-1) > 0.001) throw new Error('Invalid particle snapshot influence.');
    return { position, joints, weights };
  });
}
