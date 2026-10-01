# Viewer material color pipeline

The preview's shared `pbr.vfx` color stage uses ValveResourceFormat's reverse-engineered material behavior. Source 2 Viewer and its contributors established these rules; this is not an independent discovery of the engine's formats.

Checked source revision: [`b20af3819872f010da71c74c47e79191bb070c97`](https://github.com/ValveResourceFormat/ValveResourceFormat/tree/b20af3819872f010da71c74c47e79191bb070c97).

- [`VfxEvalFunctions.MatrixColorCorrect2`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b20af3819872f010da71c74c47e79191bb070c97/ValveResourceFormat/Serialization/VfxEval/VfxEvalFunctions.cs) composes contrast about a per-channel pivot, brightness, then its saturation-axis transform. Its normalized luminance-axis scale/rotation/unscale construction simplifies to normalized squared Rec. 709 weights, rather than a standard Rec. 709 dot product. Inputs and outputs remain linear and unclamped.
- [`RenderMaterial.EvalDeadlockColorMatrices`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b20af3819872f010da71c74c47e79191bb070c97/Renderer/Renderer/Materials/RenderMaterial.cs) supplies the albedo texture's reflectivity directly as the pivot. It converts the authored tint from sRGB to linear before building the tint matrix. Tint modes multiply, preserve luminance and mod2x have corresponding matrix paths.
- [`pbr.frag.slang`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b20af3819872f010da71c74c47e79191bb070c97/Renderer/Shaders/pbr.frag.slang) applies correction before masked texture tint, placing vertex tint on either side as authored. Detail albedo follows these stages. Missing mask switches default to enabled.
- [`RenderTexture`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b20af3819872f010da71c74c47e79191bb070c97/Renderer/Renderer/RenderTexture.cs) retains compiled texture reflectivity unchanged. It should not receive a second transfer-function conversion.

## Export compatibility

The pinned [`vpkmerge v0.19.1 exporter`](https://github.com/Slush97/vpkmerge/blob/v0.19.1/morphic/src/model/glb.rs) emits morphic schema 2 and copies the raw `g_vColorTint1` directly to glTF's linear base-color factor. Its comment calls that value linear; the VRF Deadlock matrix evaluator instead explicitly converts it from sRGB. The preview corrects only schema-2 `pbr.vfx` materials whose factor matches the raw authored tint or its already-linear counterpart. Ordinary GLBs, future schemas, independently edited factors and dynamic tint overrides are left alone.

At load, a proven legacy factor receives one sRGB decode. Wrapped materials remove that factor from an owned clone (the legacy wrapper restores the corrected base on teardown), then apply the authored linear tint after correction through its mask. Rebuilding, changing preview flags and restoring the legacy path do not apply the transfer function or tint again. Alpha remains independent.

## Reflectivity limitation

The pinned exporter does not emit the compiled VTEX reflectivity. The viewer can consume an optional future `texture_reflectivity.g_tColor` vector; current GLBs use a cached mean of the decoded albedo's linear pixels. This is an explicit approximation to compiled reflectivity, not proof of the same engine value. Very large images are bounded to 2048 pixels on the longest side before averaging. If pixels cannot be read, the stage uses VRF's missing-texture white default.

The fallback is shared by all heroes and does not include the exported material tint. No individual hero is recolored to compensate for missing information. Exact pivot parity requires exporter support for the VTEX header, cache invalidation and fresh exports.

## Verification and limits

Numerical regressions cover nonidentity correction, channel-specific pivots,
negative/HDR results, schema/tint-domain guards, repeated builds, legacy restore
and linear pixel averages. Shader tests cover stage ordering in the shared
production material path.

Dynamic scene-attribute colors such as `$COLOR` remain unresolved without the
corresponding runtime input. Constant tint/rim textures are valid authored data,
not necessarily missing masks. A correct fallback average or static tint guard
does not establish equivalence to compiled texture reflectivity or game lighting.
