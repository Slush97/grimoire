// Compare production GLSL with the pinned VRF functions on the same GPU.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const pin = '7c55bc278ef05726e764f0b590c6d252481574c9';
const vrf = '.codex-run/vrf-src';
if (execFileSync('git', ['-C', vrf, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim() !== pin) throw new Error('VRF pin mismatch');
const source = readFileSync(`${vrf}/Renderer/Shaders/pbr.vert.slang`, 'utf8');
const port = readFileSync('src/lib/particles/render/pbrAnimation.ts', 'utf8').split('/* glsl */ `')[1].split('`;')[0];
function functionText(text, signature) {
  const start = text.indexOf(signature), brace = text.indexOf('{', start);
  if (start < 0 || brace < 0) throw new Error(`Missing ${signature}`);
  let depth = 1, end = brace + 1;
  while (depth && end < text.length) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; }
  return text.slice(start, end);
}
const declarations = port.slice(port.indexOf('uniform'), port.indexOf('vec3 GetJitterWave'));
const reference = declarations + functionText(source, 'vec3 GetJitterWave(') + functionText(source, 'vec3 GetJitterDisplacement(');
const samples = Array.from({ length: 256 }, (_, n) => [11659.17578125 + n * .125, -6336.99951171875 - n * 1.125, -293 + n * .33]).flat();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ port, reference, samples }) => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL2 required');
    const run = (functions, time, quantizeTime, quantizeDisplacement, mask, mode) => {
      const compile = (kind, source) => { const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es\nprecision highp float;\n#define F_JITTER_VERTICES 1\n${functions}\nin vec3 position;out vec3 result;void main(){result=GetJitterDisplacement(position,vec2(0.5));gl_Position=vec4(0,0,0,1);}`));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1);}'));
      gl.transformFeedbackVaryings(program, ['result'], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const scalar = (name, value) => gl.uniform1f(gl.getUniformLocation(program, name), value);
      const vector = (name, value) => gl.uniform3fv(gl.getUniformLocation(program, name), value);
      scalar('g_flTime', time); scalar('g_flJitterQuantizeTime1', quantizeTime); scalar('g_flJitterQuantizeDisplacement1', quantizeDisplacement);
      scalar('g_flJitterSpeedA1', .056); scalar('g_flJitterSpeedB1', .02);
      vector('g_vJitterFrequenciesA1', mode ? [-.013, .001, .001] : [.02, .04, .08]);
      vector('g_vJitterFrequenciesB1', [.001, .001, 0]);
      vector('g_vJitterAmplitudesXA1', [4, 4, 4]); vector('g_vJitterAmplitudesYA1', [0, 4, 0]); vector('g_vJitterAmplitudesZA1', [0, 2, 2]);
      vector('g_vJitterAmplitudesXB1', [5.053, 9.387, 10.122]); vector('g_vJitterAmplitudesYB1', [8.421, 4.267, 0]);
      vector('g_vJitterAmplitudesZB1', [12.632, 0, 0]); vector('g_vJitterExpression', [.25, -.5, 1]);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([mask, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.uniform1i(gl.getUniformLocation(program, 'g_tJitterMask'), 0);
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const input = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(samples), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
      const output = gl.createBuffer(); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, samples.length * 4, gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output); gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, samples.length / 3); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
      const values = new Float32Array(samples.length); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, values);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.deleteBuffer(input); gl.deleteBuffer(output); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteProgram(program);
      return values;
    };
    let maxError = 0, cases = 0;
    for (const time of [-3.125, 0, .074, .076, .224, .226, 9.37]) for (const quantize of [0, .15]) for (const displacement of [0, .125]) for (const mask of [0, 95, 255]) for (const mode of [0, 1]) {
      const a = run(port, time, quantize, displacement, mask, mode), b = run(reference, time, quantize, displacement, mask, mode);
      for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Nonfinite GPU result'); maxError = Math.max(maxError, Math.abs(a[i] - b[i])); }
      cases += a.length / 3;
    }
    return { cases, maxError, glError: gl.getError() };
  }, { port, reference, samples });
  const proof = { pin, ...result };
  writeFileSync(process.argv[2] ?? '.codex-run/hideout-oracle/pbr-animation-particles.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  if (result.maxError !== 0 || result.glError !== 0) throw new Error('PBR animation differs from pinned VRF');
} finally { await browser.close(); }
