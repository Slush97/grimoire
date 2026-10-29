# Third-party notices

## ValveResourceFormat

`src/lib/particles/` is a TypeScript port of the particle simulation of
[ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat), at commit
`7c55bc278ef05726e764f0b590c6d252481574c9`, and `src/lib/particles/render/` a three.js port of
its particle renderers, spritecard shaders and post process at the same commit. Each ported file
names the source file it came from. `tools/particle-oracle/` and `tools/particle-render-oracle/`
(dev-only, not shipped) build against the same commit.

`src/lib/source2ProbeVolume.ts` and `src/lib/source2DynamicLights.ts` adapt the
LPV, light distribution and barn-light calculations from `lighting.lpv.slang`,
`envmap_data.slang`, `lighting.barn.slang` and `SceneLight.cs` at that commit.
`tools/hideout-oracle/` builds its fixed-camera reference against the same source.

The MIT License (MIT)

Copyright (c) 2015 ValveResourceFormat Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

