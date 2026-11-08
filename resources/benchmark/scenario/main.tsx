import { addBot, after, Buttons, command, every, log, matchClock, onDamage, onDamaged,
  onFrame, onStart, onWorld, players, poseAt, Puppet, readFile, restoreHero, serverCommand,
  type EquipmentTarget, type Player, type Timer, type Track } from 'modlock'

type Actor = { slot: number; hero: number; team: number; level: number; maxHealth: number;
  abilities: EquipmentTarget[]; items: EquipmentTarget[]; recastBases?: number[] }
type Cast = { tick: number; slot: number; abilitySlot: number; id: number; className: string }
type Clip = { ticks: number; leadInTicks: number; actors: Actor[]; casts: Cast[];
  repetitions?: number;
  adaptCurrentBuild: boolean; motionOnly: boolean; cameraSlot: number;
  selection: { anchor: number[] }; source: { sha256: string; map: string } }
type Live = { actor: Actor; player: Player; track: Track; puppet?: Puppet }
const raw = readFile('clip.json')
if (!raw) throw new Error('Package a replay clip with prepare.py before launching this scenario')
const clip = JSON.parse(raw) as Clip
const repetitions = clip.repetitions ?? 1
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Invalid repetition count')
let live: Live[] = []
let timers: Timer[] = []
let operator: Player | undefined
let phase = 'Ready: /bench_start (experimental reconstruction)'
let running = false
let generation = 0
let auto = false
let attempted = false
let world = ''
let started: number | undefined
let castIndex = 0
let observedCasts = 0
let observedHits = 0
let requestedCasts = 0
let rejectedCasts = 0
let measured = false
let pass = 'warmup'
let maxDrift = 0
let frames = 0
let measuredPass = 0

function display(text: string): void {
  phase = text
  log(`REPLAY PROBE ${text} game_time=${matchClock() ?? 'unknown'} repetition=${measuredPass}/${repetitions}`)
  operator?.centerText(text)
}

function cleanup(): void {
  for (const t of timers) t.cancel()
  timers = []
  for (const a of live) { if (a.puppet) a.puppet.stop(); else a.player.removeBot() }
  live = []
  started = undefined
}

function stop(reason: string): void {
  generation++
  running = false
  cleanup()
  display(reason)
  operator?.unwatch()
}

function camera(): boolean {
  if (!operator) return false
  const pawn = live.find(a => a.actor.slot === clip.cameraSlot)?.player.pawn()
  return pawn !== undefined && operator.watch(pawn.entity, true)
}

function setup(nextPass: string): void {
  for (const timer of timers) timer.cancel()
  timers = []
  started = undefined
  // Keep controller slots and the watched pawn stable across repetitions.
  // Removing and respawning the whole roster grows client slot numbers.
  for (const a of live) {
    a.puppet?.pause()
    a.puppet?.seek(0)
    a.player.drive({ facing: poseAt(a.track, 0)!.facing, held: 0n, pressed: 0n, forward: 0, left: 0 })
  }
  pass = nextPass
  const current = generation
  display(`SETUP ${pass}: 12 replay actors`)
  // Allow a rewound dead pawn to respawn before restoring its equipment.
  timers.push(after(2, () => {
    if (current !== generation) return
    for (const actor of live.length ? [] : clip.actors) {
      const encoded = readFile(`actor-${actor.slot}.json`)
      if (!encoded) { stop('INVALID: missing actor track'); return }
      const track = JSON.parse(encoded) as Track
      if (clip.motionOnly) delete track.health
      const pose = poseAt(track, 0)
      if (!pose) { stop('INVALID: empty actor track'); return }
      const player = addBot({ name: `Replay ${actor.slot}`, hero: actor.hero, team: actor.team, position: pose.position })
      if (!player) { stop(`INVALID: bot ${actor.slot} could not join`); return }
      live.push({ actor, player, track })
    }
    timers.push(after(5, () => {
      if (current !== generation) return
      let ready = 0
      for (const a of live) {
        if (current !== generation) return
        const pose = poseAt(a.track, 0)!
        if (!a.player.freeze(true) || !a.player.drive({ facing: pose.facing, forward: 0, left: 0, held: 0n, pressed: 0n })) {
          stop(`INVALID: could not hold actor ${a.actor.slot} during setup`); return
        }
        const currentAbilities = a.player.abilities()
        log(`REPLAY PROBE abilities slot=${a.actor.slot} current=${JSON.stringify(currentAbilities.filter(x => x.slot < 4))}`)
        const abilities = clip.adaptCurrentBuild
          ? currentAbilities.filter(x => x.slot < 4).map(x => ({ id: x.id, slot: x.slot, state: x.state }))
          : a.actor.abilities
        if (clip.adaptCurrentBuild) {
          for (const ability of currentAbilities.filter(x => x.slot < 4)) a.player.setAbility({ ability: ability.name, upgrades: 3 })
          log(`REPLAY PROBE adapted slot=${a.actor.slot}: current abilities by slot; recorded equipment omitted`)
        }
        const recastBases = a.actor.recastBases ?? []
        const restoreRecasts = !clip.adaptCurrentBuild && recastBases.length > 0
        if (restoreRecasts) {
          // The engine swaps these base abilities to slot 23 when upgraded.
          // Restore tiers by definition, then verify the complete packed state
          // after equipment settles. Only recorded recast bases may move slots.
          for (const wanted of abilities) {
            const owned = currentAbilities.find(x => x.id === wanted.id)
            if (!owned || (wanted.state & 0xffff) !== 0 || !a.player.setAbility({ ability: owned.name, upgrades: wanted.state >>> 16 })) {
              stop(`INVALID: recast tiers slot ${a.actor.slot}`); return
            }
          }
        }
        if (!a.player.watchMovement(true)) { stop('INVALID: movement observation rejected'); return }
        const accepted = restoreHero(a.player, { position: pose.position, facing: pose.facing,
          health: clip.adaptCurrentBuild ? a.actor.maxHealth : Math.max(1, pose.health ?? 1),
          maxHealth: a.actor.maxHealth, level: a.actor.level,
          abilities: clip.adaptCurrentBuild || restoreRecasts ? undefined : abilities,
          items: clip.adaptCurrentBuild ? [] : a.actor.items }, (error) => {
            if (current !== generation) return
            if (error) {
              log(`REPLAY PROBE restore_failure slot=${a.actor.slot} expected=${JSON.stringify(abilities)} actual=${JSON.stringify(a.player.abilities().filter(x => x.slot < 4 || abilities.some(wanted => wanted.id === x.id)))}`)
              stop(`INVALID: restore slot ${a.actor.slot}: ${error}`); return
            }
            if (restoreRecasts && !abilities.every(wanted => a.player.abilities().some(actual =>
              actual.id === wanted.id && actual.state === wanted.state &&
              (actual.slot === wanted.slot || (recastBases.includes(wanted.id) && actual.slot === 23))))) {
              stop(`INVALID: recast build verification slot ${a.actor.slot}`); return
            }
            log(`REPLAY PROBE restored slot=${a.actor.slot} hero=${a.player.pawn()?.hero}`)
            ready++
            if (ready === clip.actors.length) begin()
          })
        if (!accepted) { stop(`INVALID: restore request slot ${a.actor.slot}`); return }
      }
    }))
    timers.push(after(40, () => {
      if (current === generation && started === undefined) stop('INVALID: actor setup timed out')
    }))
  }))
}

function begin(): void {
  if (!camera()) { stop('INVALID: camera request rejected'); return }
  started = matchClock()
  if (started === undefined) { stop('INVALID: game clock missing'); return }
  castIndex = observedCasts = observedHits = requestedCasts = rejectedCasts = frames = 0
  measured = false
  maxDrift = 0
  for (const a of live) {
    if (!a.player.freeze(false)) { stop('INVALID: could not release setup hold'); return }
    if (!a.puppet) a.puppet = new Puppet(a.player, a.track)
    else a.puppet.seek(0)
    a.puppet.play()
  }
  display(`${pass === 'warmup' ? 'WARMUP' : 'LEAD-IN'}: ${clip.motionOnly ? 'replay motion only' : 'replay motion, real casts, synthetic gunfire'}`)
}

function start(player: Player): void {
  if (running) return
  if (world !== clip.source.map) { player.chat(`Load ${clip.source.map} first`); return }
  operator = player
  if (!player.spectate()) { display('INVALID: could not enter spectator mode'); return }
  running = true
  measuredPass = 0
  generation++
  log(`REPLAY PROBE source=${clip.source.sha256} source_ticks=${clip.ticks} score_eligible=false`)
  setup('warmup')
}

onStart((args) => {
  // Match upstream's arena preset without requiring its newer SDK helper.
  for (const setting of ['sv_hibernate_when_empty', 'citadel_solo_bot_match',
    'citadel_koth_enabled', 'citadel_trooper_spawn_enabled', 'citadel_neutral_spawn_enabled',
    'citadel_spawn_practice_bots', 'citadel_start_players_on_zipline']) {
    if (!serverCommand(`${setting} 0`)) throw new Error(`Could not configure ${setting}`)
  }
  auto = args.includes('demo')
  if (auto) serverCommand('citadel_player_starting_team 1')
})
onWorld((map) => {
  if (running) stop('INVALID: world changed')
  world = map
  if (auto && !attempted) {
    const timer = every(1, () => {
      const human = players().find(p => !p.bot && p.ready)
      if (!human || attempted) return
      attempted = true
      timer.cancel()
      start(human.player)
    })
    timers.push(timer)
  }
})

onDamage(hit => {
  if (running && live.some(a => a.player.pawn()?.entity === hit.victim)) return { amount: 0 }
})
onDamaged(hit => {
  if (running && live.some(a => a.player.pawn()?.entity === hit.attacker)) observedHits++
})
onFrame(frame => {
  if (!running || started === undefined) return
  const now = matchClock()
  if (now === undefined) { stop('INVALID: lost game clock'); return }
  if (!players().some(p => p.player.slot === operator?.slot)) { stop('INVALID: operator left'); return }
  const tick = (now - started) * 64
  if (pass === 'measured' && !measured && tick >= clip.leadInTicks) {
    measured = true
    display('BENCH START: exploratory; no validated score')
  }
  for (const sample of frame.movement) {
    const actor = live.find(a => a.player.slot === sample.player.slot)
    if (actor) {
      for (const id of sample.casts) {
        const ability = actor.player.abilities().find(a => a.entity === id && a.slot < 4)
        if (!ability) continue
        observedCasts++
        log(`REPLAY PROBE observed_hero_cast source_slot=${actor.actor.slot} runtime_slot=${sample.player.slot} id=${ability.id} handle=${id} tick=${tick}`)
      }
    }
  }
  const presses = new Map<number, bigint>()
  while (!clip.motionOnly && castIndex < clip.casts.length && clip.casts[castIndex].tick <= tick) {
    const c = clip.casts[castIndex++]
    const a = live.find(a => a.actor.slot === c.slot)
    requestedCasts++
    const ability = a?.player.abilities().find(x => x.slot === c.abilitySlot && (clip.adaptCurrentBuild || x.id === c.id))
    if (!a || !ability || !a.player.pawn()?.health || !a.player.refreshAbility(ability.name)) {
      rejectedCasts++
      log(`REPLAY PROBE rejected_cast slot=${c.slot} id=${c.id} source_tick=${c.tick}`)
      continue
    }
    const buttons = [Buttons.ability1, Buttons.ability2, Buttons.ability3, Buttons.ultimate]
    log(`REPLAY PROBE requested_cast slot=${c.slot} source_id=${c.id} runtime_id=${ability.id} source_tick=${c.tick} runtime_tick=${tick}`)
    presses.set(c.slot, (presses.get(c.slot) ?? 0n) | buttons[c.abilitySlot])
  }
  for (const a of live) {
    const pose = poseAt(a.track, tick)
    const pawn = a.player.pawn()
    if (!pose || !pawn) { stop('INVALID: missing actor during playback'); return }
    if (pawn.health <= 0) continue
    const reload = (now - started) % 6 > 4.5
    if (!a.player.drive({ facing: pose.facing, forward: 0, left: 0,
      held: clip.motionOnly ? 0n : reload ? Buttons.reload : Buttons.attack, pressed: presses.get(a.actor.slot) ?? 0n })) {
      stop(`INVALID: input rejected slot ${a.actor.slot}`); return
    }
    const distance = Math.hypot(pawn.position.x - pose.position.x, pawn.position.y - pose.position.y, pawn.position.z - pose.position.z)
    maxDrift = Math.max(maxDrift, distance)
  }
  frames++
  if (frames % 64 === 0) log(`REPLAY PROBE progress pass=${pass} tick=${tick} actors=${live.length} max_drift=${maxDrift}`)
  if (tick >= clip.ticks) {
    display(`${pass === 'measured' ? 'BENCH END' : 'WARMUP END'} requested_casts=${requestedCasts} rejected_casts=${rejectedCasts} observed_hero_casts=${observedCasts} hits=${observedHits} max_drift=${maxDrift.toFixed(1)}`)
    log('REPLAY PROBE counts_include_lead_in=true')
    log('REPLAY PROBE score_eligible=false: synthetic weapon inputs, forced motion/health, world/build differences')
    if (pass === 'warmup' || measuredPass < repetitions) {
      measuredPass++
      setup('measured')
    }
    else {
      running = false
      started = undefined
      for (const a of live) a.puppet?.pause()
    }
  }
})

command('bench_start', start)
command('bench_stop', player => { if (!operator || player.slot === operator.slot) stop('STOPPED') })
command('bench_status', player => player.chat(phase))
