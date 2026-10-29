# Particle fixtures

Ground truth for `particles.test.ts`, which replays each one against the runtime with no .NET
installed.

- `<effect>.json`: a trimmed run of `tools/particle-oracle` (ValveResourceFormat's simulation) over a
  Deadlock particle system. It holds the decoded definitions the tree reads (KV3 DATA decoded to JSON,
  as the app produces them, with the renderer members the simulation never reads dropped), each
  file's stored KV3 format, the control point inputs of every frame, and a sample of the frames.
  Regenerate one with the command below; the moving and spinning control points are part of it.

  ```bash
  pnpm exec tsx scripts/particle-diff.ts particles/heroes/haze/haze_head_ambient_smokey.vpcf \
    --cp 0=10,-20,5 --cp-move 0=60,0,20 --cp-spin 0=120 --fixture src/lib/particles/__fixtures__/haze_smokey.json
  ```

  The other fixtures and their arguments: `abrams_book_glow` (none), `abrams_book`
  (`--cp 0=10,-20,5 --cp-move 0=40,15,-8 --cp-spin 0=90`), `necro_flame_contour`
  (`--cp-move 0=100,50,0 --cp-spin 0=45 --seed 77`), `chessmaster_halo`
  (`--cp-move 0=30,30,30 --cp-spin 0=200`), `mcginnis` (`--cp-move 0=-50,10,0 --cp-spin 0=60`) and
  `drifter_pose` (`--cp-move 0=20,0,0 --cp 1=5,5,5 --cp-move 1=0,20,0 --cp-spin 1=90`).

- `dotnet_numerics.json`: System.Numerics results on random inputs as float bits, from
  `ParticleOracle --numerics-cases <out.json>`.

The `batch38_*.json` fixtures replay 192 frames with `--exact --cp-move 0=7,3,2
--cp-spin 0=37 --stop-frame 64`. Most save frames 0, 63, 64 and 191. The gravestone
fixture saves frame 0 to keep the tree below 100 KB; the Dynamo fixture saves 0, 64
and 191. All 192 frames were compared before saving each fixture.

`melee_heavy_activate_light.json` (`C_OP_FadeAndKill`) and `air_dash_streaks.json` (`C_OP_AlphaDecay`)
use the same arguments and save frames 0, 10, 40, 63, 64 and 191.

The `model_*.json` fixtures cover the four model functions (`C_INIT_CreateOnModel`,
`C_OP_LockToBone`, `C_INIT_InitSkinnedPositionFromCPSnapshot`,
`C_OP_SnapshotRigidSkinToBones`). Each binds a hero model to control point 0 with moving
placement and posed bones, and stores the model as VRF read it (bones as parallel arrays,
hitbox sets, render bounds) and every snapshot the tree loads, read the way the app reads it.
All six were exact over 192 frames, as were the oracle's bind pose and bone motions and the
app's own model and snapshot readers. Regenerate one with:

```bash
pnpm exec tsx scripts/particle-diff.ts particles/heroes/necro/necro_weapon_ambient.vpcf \
  --model models/heroes_wip/necro/necro.vmdl --exact --model-motion --model-move 7,3,2 \
  --cp-move 0=7,3,2 --cp-spin 0=37 --fixture-frames 0,63,64,191 \
  --fixture src/lib/particles/__fixtures__/model_necro_weapon.json
```

The others: `model_abrams_book` (`particles/abilities/abrams/abrams_ambient_book.vpcf`,
`models/heroes_wip/abrams/abrams.vmdl`), `model_familiar_body`
(`.../familiar/familiar_ambient_body.vpcf`, `models/heroes_wip/familiar/familiar_wip.vmdl`),
`model_nano_tower_elec` (`.../nano/nano_tower_ambient_elec.vpcf`,
`models/heroes_staging/nano/cat_statue/cat_statue.vmdl`), `model_unicorn_horn`
(`.../unicorn/unicorn_ambient_horn.vpcf`, `models/heroes_wip/unicorn/unicorn.vmdl`) and
`model_haze_inky_trace` (`particles/heroes/haze/haze_head_ambient_inky_trace.vpcf`,
`models/heroes_staging/haze/haze.vmdl`). They are larger than the others (64 to 151 KB)
because the replay needs the whole skeleton. The test imports them as text and parses them: the JSON
module import drops the sign of a negative zero that starts an array.

These fixtures retain negative zero. A sampled frame's `constants` table losslessly
packs uniform columns by system path and field name; the test restores their full
length before comparison. Literal inputs omit fields their constructors never
read, except remap inputs and blocks containing named value references.

Known trig difference, independent of these ports: `MathF.Sin` at float input bits
`0x407b2573` returns `0xbf34819e` on the Windows oracle, while Node's rounded
`Math.sin` returns `0xbf34819d`. Hornet's grenade debris propagates this difference
from `ParticleRandom.NextInUnitBall` into its parent and child positions. Replacing
only this result in a scratch diagnostic makes the entire 192-frame tree exact.
The runtime keeps its existing math. Minimal .NET reproduction:

```text
.codex-run/particle-oracle/bin/Release/net10.0/ParticleOracle.exe --trig-case 407b2573
```

Minimal Node reproduction:

```javascript
const view = new DataView(new ArrayBuffer(4));
view.setUint32(0, 0x407b2573, true);
view.setFloat32(0, Math.sin(view.getFloat32(0, true)), true);
console.log(view.getUint32(0, true).toString(16)); // bf34819d
```
