# Viewer NPR lighting boundary

The current preview rim is a view-Fresnel approximation, with a hemisphere gate from the preview key light and the material's rim mask. It is not Source 2's per-light NPR rim.

Checked primary sources at ValveResourceFormat revision [`b20af3819872f010da71c74c47e79191bb070c97`](https://github.com/ValveResourceFormat/ValveResourceFormat/tree/b20af3819872f010da71c74c47e79191bb070c97): [`citadel.slang`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b20af3819872f010da71c74c47e79191bb070c97/Renderer/Shaders/common/citadel.slang) and [`lighting.slang`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b20af3819872f010da71c74c47e79191bb070c97/Renderer/Shaders/common/lighting.slang). Source 2 Viewer contributors established these reverse-engineered rules.

## Source rim contract

`NprRimLight` accepts a surface normal, a direction toward one light, wrap, falloff, an up-ramp range, strength, ambient occlusion and the green channel of `g_tTintMaskRimLightMask`.

Its scalar shape is:

1. Add wrap to the normal/light dot product and divide by `(1 + wrap)^2`.
2. Clamp to 0 through 1 and raise to the falloff power.
3. Gate by the normal's Source-world Z component within the authored up-ramp range.
4. Multiply by strength, ambient occlusion and the rim mask.

There is no view-Fresnel factor in that function. Its comments describe integrating the term during each light's shading. Light attenuation, color, shadows and render gates also belong to that per-light stage. Optional depth occlusion requires a scene depth texture and authored sampling distance/tolerances.

## Why the preview does not replace its rim yet

The checked VRF revision defines the NPR helpers but does not call `NprRimLight` from its lighting evaluator. The helper's comments explicitly describe the missing wiring. It therefore establishes the scalar function and input contract, not a verified complete light integration path.

The game's NPR settings are scene/attribute globals, not the material's `F_USE_NPR_LIGHTING` flag. The current exporter supplies material extras but not an authenticated set of these globals. In the checked source, wrap, falloff, strength, up-ramp and the enable switch default to zero. Using guessed values would replace one preview calibration with another. The preview's post-light patch also runs after Three has accumulated direct lighting, where individual light vectors and attenuation are no longer available. Adding a scalar there cannot recreate evaluation for each light.

A faithful next step needs extracted scene NPR globals, explicit Source-world up after the model's axis conversion, per-light hooks before accumulation, an established color/attenuation contract, and optional scene depth for occlusion. It should be verified on real model fixtures with multiple lights and camera angles. None of those are inferred per hero.

## Bounded coordinate fix

The preview fallback now uses Three's final view-space normal, which already includes normal maps, flat shading and backface orientation. Its world-space preview key direction is transformed into view space with homogeneous `w=0`, once. Previously a view-space normal was dotted with a world-space light direction, making camera orbit change the light gate. The same correction applies to the existing preview transmissive hemisphere gate. It adds no second normal-map transform and introduces no guessed game globals.

Tests check the shader's coordinate contract and invariant normal/light dot products across camera rotations and translations. They establish the coordinate correction, not game-equivalent NPR lighting.

## Preview diffuse bands

The preview's direct diffuse bands operate on the lighting factor, with the diffuse albedo restored afterward. Three's diffuse response already includes the material color. Quantizing that accumulated color directly makes band selection depend on the paint: a dark garment can lose directional light while a pale garment under the same light retains it. The shared patch divides direct diffuse luminance by diffuse albedo luminance before selecting the band. It retains the accumulated light hue and bounded rescaling, with guards for black and unlit surfaces. Indirect light, specular, emission, material tint and the authored color-correction stage remain independent.

This is a correction to the preview's calibrated banding, not a reconstruction of Source 2's missing scene NPR globals. Regression checks evaluate the shader expressions with dark and pale albedos under equal lighting, plus black and unlit inputs. Four-hero rendered comparisons verify the production material path; they do not establish reference or game parity.
