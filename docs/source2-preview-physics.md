# Source 2 preview physics

The viewer simulates supported cloth and accessories from exported FeModel data.
Fresh previews enable cloth where that data is available; an explicit saved
choice takes precedence. Missing physics leaves animation available without an
unavailable-physics notice. The solver is a preview implementation, not the
complete game simulation.

## Model and animation ownership

The rigged model and `cloth-rigged.json` use the same source, selector and cache
key, including installed-skin fallback. Loading waits for the pair before
mounting animation so bind-pose calibration cannot use an arbitrary played frame.
Incomplete exports are not cache hits.

`feModel.ts` validates and normalizes nodes, constraint references, coefficients
and optional arrays. `useClothSim.ts` maps model-bind data to the exported
skeleton, owns simulation state and restores the clean animation state on
teardown. Axis and Source-unit conversion apply once at the boundary. Locked
anchors follow animation; dynamic nodes retain separate integration history.
Authored reverse offsets and rotation-producing constraints must not be treated
as ordinary locked bone positions.

## Supported solver path

The fixed-step clock runs at 120 Hz, independently of render frame rate. Input
and substep budgets are bounded. Suspension, discontinuous seeking, teleports
and invalid output reset history rather than integrating an unbounded jump.

Supported passes include raw and goal-damped attraction, fixed/animated rods,
triangle and quad elements, stray limits, Kelager bends, hinge limits,
directed twist/swing links, rope reconstruction and supported body contacts.
`clothConstraints.ts` contains the shared kernels. Coefficients are compiled
solver values, not interchangeable authoring strengths; array-presence switches
and constraint ordering are significant.

Format and reconstruction references come from Source 2 Viewer/ValveResourceFormat
contributors: the [FeModel reader](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.cs),
[collision reconstruction](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.Collisions.cs),
[skin-weight reconstruction](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.SkinWeights.cs)
and [node-base ties](https://github.com/w1tcherrr/ValveResourceFormat/blob/c22f897342e53f999bd7c466d648f5bbbe85bafa/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Softbody/FeModel.NodeBaseTies.cs).
These document compiled data, not a complete runtime solver. Numerical reference
fixtures separately retain their evaluation provenance.

Collision handling distinguishes the supported sphere, box and friction paths.
Moving-body contacts use the corresponding body transform/history. Invalid
references and malformed graph data are rejected instead of assigned invented
anchors or collision shapes.

## Reproduce and test

See [viewer development](viewer-development.md) for the production asset harness.
To compare cloth with an optional Source 2 Viewer CLI export:

```bash
node scripts/preview-cloth.mjs --game "<game-directory>" --case yamato,dynamo --s2v "<Source2Viewer-CLI-path>"
```

The harness serves `/cloth-preview.html` on loopback. `S2V_CLI` also selects the
reference exporter. Use the same actual source model and animation when comparing
exports; a different bind scale or additional mesh is not a solver trajectory.

```bash
pnpm exec vitest run src/lib/clothConstraints.test.ts src/lib/feModel.test.ts src/lib/useClothSim.test.ts src/lib/useClothSim.harness.test.ts src/lib/useClothSim.safety.test.ts
```

Regression fixtures contain synthetic positions, history, targets and numerical
outputs for isolated compiled-kernel comparisons. Tests also cover malformed
data, locked anchors, animation ownership, rest pose, frame-rate equivalence,
pause/reset/resume and cleanup. Fixture provenance is retained beside the data.

## Limits

Individual-pass numerical agreement does not prove a complete game trajectory.
Gameplay initialization, scene/instance overrides, some collision families and
matching animation goals may be unavailable to the offline export. Preview cloth
can fold or clip normally; inspect silhouette and stable motion rather than
requiring a perfectly straight garment. Compare identical animation time and
fresh versus warmed simulation before attributing a visible difference to a
constraint or anchor bug.
