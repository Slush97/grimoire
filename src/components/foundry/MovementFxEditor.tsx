import { useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { Download, Upload, RotateCcw, Shield, Sparkles, Star, Link2, Unlink2, Undo2, Redo2, type LucideIcon } from 'lucide-react';
import { Button, IconButton, SegmentedControl, Toggle } from '../common/ui';
import { Input } from '../common/forms';
import { SharedHeroViewer } from '../locker/LockerViewerHost';
import { useFoundryDraft } from '../../lib/useFoundryDraft';
import { useEditHistory } from '../../lib/useEditHistory';
import { PARRY_PARTS, movementFxSchema, type MovementFxChoice, type MovementPalette, type ParryPart, type ParryParts } from '../../lib/movementFx';
import { movementFxThumbnail } from '../../lib/movementFxThumbnail';
import { useAppStore } from '../../stores/appStore';
import type { HeroPoseSkinSource } from '../../types/portrait';
import { WorkshopWorkbench } from './WorkshopWorkbench';
import { SharedSoundSwaps } from './SoundBrowse';

/** The parry's sound clips (soundevents/player.vsndevts: Player.Melee.Parry.Shared and .Success.Shared). */
const PARRY_SOUNDS = [
  { labelKey: 'foundry.movement.parrySound', event: 'Player.Melee.Parry.Shared', vsnd: ['sounds/player/melee/shared/melee_parry_cast.vsnd'] },
  { labelKey: 'foundry.movement.parrySuccessSound', event: 'Player.Melee.Parry.Success.Shared', vsnd: ['sounds/player/melee/shared/melee_parry_success.vsnd'] },
] as const;

const EMOJIS = ['😈', '💀', '😭', '🔥', '🗿', '🤡', '💩', '✨', '❤️', '👀', '🦅', '🐀', '🍌', '🗣️'];

function emojiStamp(emoji: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image drawing is unavailable.');
  context.font = '192px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(emoji, 128, 136, 232);
  return canvas.toDataURL('image/png');
}

async function imageStamp(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image up to 4 MiB.');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image drawing is unavailable.');
    const scale = Math.min(232 / image.width, 232 / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } finally { image.close(); }
}

const PART_ICONS: Record<ParryPart, LucideIcon> = { shield: Shield, catch: Sparkles, stun: Star };

/** Every part linked to the effect's color, as a parry saved before parts reads. */
function linkedParts(choice: MovementFxChoice): ParryParts {
  const part = { original: false, color: choice.color, palette: choice.palette };
  return { linked: true, shield: part, catch: part, stun: part };
}

/** A swatch of a palette: solid, a gradient, the rainbow, or an empty ring for the game's own colors. */
function paletteSwatch(color: string, palette: MovementPalette, original: boolean): CSSProperties {
  if (original) return { background: 'transparent' };
  if (palette.mode === 'rainbow') return { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' };
  if (palette.mode === 'gradient') return { background: `linear-gradient(135deg, ${color}, ${palette.end})` };
  return { backgroundColor: color };
}

export default function MovementFxEditor({ heroName, skinSources }: { heroName: string; skinSources?: HeroPoseSkinSource[] }) {
  const { t } = useTranslation();
  const [kind, setKind] = useFoundryDraft('movement:kind', z.enum(['dash', 'heavy-melee', 'parry']), 'dash');
  // Undo and redo answer anywhere in the section, the kind switch included
  const sectionRef = useRef<HTMLElement>(null);
  return <section ref={sectionRef} className="@container flex flex-1 flex-col gap-3">
    <SegmentedControl value={kind} onChange={setKind} options={[
      { value: 'dash', label: t('foundry.movement.dash') }, { value: 'heavy-melee', label: t('foundry.movement.heavy-melee') },
      { value: 'parry', label: t('foundry.movement.parry') },
    ]} />
    <MovementSession key={`${kind}:${heroName}`} kind={kind} heroName={heroName} skinSources={skinSources} root={sectionRef} />
  </section>;
}

function MovementSession({ kind, heroName, skinSources, root }: {
  kind: MovementFxChoice['kind']; heroName: string; skinSources?: HeroPoseSkinSource[]; root: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const initial: MovementFxChoice = { kind, color: '#ff70cf', palette: { mode: 'solid' }, parts: null, image: null, stunImage: null,
    brightness: 1, illuminated: false, outline: false, outlineColor: '#ffffff' };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<MovementFxChoice | null>(null);
  // Every change to the choice is a step (a drag one); the steps last the session, per kind
  const history = useEditHistory({ key: `movement:${kind}:choice`, schema: movementFxSchema, initial, disabled: busy, root,
    session: true, redoWithY: true, onTravel: () => { setSaved(null); setError(null); } });
  const { value: choice, setValue: setChoice } = history;
  const [replay, setReplay] = useState(0);
  const [loop, setLoop] = useFoundryDraft('movement:loop', z.boolean(), true);
  const [colorStop, setColorStop] = useState<'head' | 'tail'>('head');
  const [part, setPart] = useState<ParryPart>('shield');
  // The viewer recolours the game's own effects as the choice changes: nothing bakes until Save or Export
  const movementPreview = useMemo(() => ({ kind, revision: replay, loop, request: { choice, heroName } }), [kind, replay, loop, choice, heroName]);
  const apply = async (save: boolean) => {
    setBusy(true); setError(null); setSaved(null);
    try {
      if (save) { await window.electronAPI.saveMovementFx({ choice, thumbnailDataUrl: await movementFxThumbnail(choice) }); await useAppStore.getState().loadMods(); setSaved(choice); }
      else await window.electronAPI.exportMovementFx(choice);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  // A parry's parts: linked parts take the effect's color, unlinked ones their own
  const parts = kind === 'parry' ? choice.parts ?? linkedParts(choice) : null;
  const selected = parts?.[part] ?? null;
  const ownColor = !!parts && !parts.linked;
  const target = ownColor && selected ? { color: selected.color, palette: selected.palette } : { color: choice.color, palette: choice.palette };
  const setTarget = (next: { color?: string; palette?: MovementPalette }) => {
    if (ownColor && parts && selected) setChoice({ ...choice, parts: { ...parts, [part]: { ...selected, ...next } } });
    else setChoice({ ...choice, ...next });
  };
  const setLinked = (linked: boolean) => {
    if (!parts) return;
    // Unlinking starts every part from the effect's color
    const from = (value: ParryParts[ParryPart]) => ({ ...value, color: choice.color, palette: choice.palette });
    setChoice({ ...choice, parts: linked ? { ...parts, linked } : { linked, shield: from(parts.shield), catch: from(parts.catch), stun: from(parts.stun) } });
  };
  const setOriginal = (original: boolean) => {
    if (parts && selected) setChoice({ ...choice, parts: { ...parts, [part]: { ...selected, original } } });
  };
  const keepsEverything = !!parts && PARRY_PARTS.every((name) => name === part || parts[name].original) && !choice.image && !choice.stunImage;
  const editingTail = target.palette.mode === 'gradient' && colorStop === 'tail';
  const color = editingTail && target.palette.mode === 'gradient' ? target.palette.end : target.color;
  const changeColor = (value: string) => {
    const hex = value.replace('#', '');
    const next = `#${hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex}`;
    setTarget(editingTail ? { palette: { mode: 'gradient', end: next } } : { color: next });
  };
  return <div onPointerDownCapture={history.onPointerDownCapture} onFocusCapture={history.onFocusCapture}
    onBlurCapture={history.onBlurCapture} onKeyDownCapture={history.onKeyDownCapture} className="flex flex-1 flex-col gap-3">
    <WorkshopWorkbench preview={<>
          <SharedHeroViewer heroName={heroName} skinSources={skinSources} workspaceKey={`movement:${heroName}`}
            initialScene="studio" initialBackground="none"
            movementPreview={movementPreview} />
        </>}
        previewFooter={<>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setReplay(v => v + 1)}>{t('foundry.movement.replay')}</Button>
          <Toggle label={t('foundry.movement.loop')} checked={loop} onChange={setLoop} />
        </>}
        footer={<>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-secondary">{t('foundry.movement.globalHint')}</p>
            <div className="flex items-center gap-1">
              <IconButton size="sm" icon={Undo2} label={t('common.actions.undo')} aria-keyshortcuts="Control+Z Meta+Z" disabled={!history.canUndo} onClick={history.undo} />
              <IconButton size="sm" icon={Redo2} label={t('common.actions.redo')} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" disabled={!history.canRedo} onClick={history.redo} />
              <IconButton size="sm" icon={RotateCcw} label={t('foundry.movement.reset')} disabled={busy} onClick={() => { setChoice(initial); setError(null); }} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" isLoading={busy} onClick={() => void apply(true)}>{t('foundry.skin.saveEnable')}</Button>
            <Button variant="secondary" icon={Download} disabled={busy} onClick={() => void apply(false)}>{t('foundry.movement.export')}</Button>
          </div>
          {saved === choice && <p role="status" className="text-xs text-state-success">{t('foundry.movement.saved')}</p>}
          {error && <p role="alert" className="break-words text-xs text-state-danger">{error}</p>}
        </>}>
        {parts && <fieldset disabled={busy} className="min-w-0 space-y-2">
          <legend className="sr-only">{t('foundry.movement.parts')}</legend>
          <div className="flex items-stretch gap-1">
            <div role="radiogroup" aria-label={t('foundry.movement.parts')} className="grid min-w-0 flex-1 grid-cols-3 gap-1">
              {PARRY_PARTS.map((name) => {
                const value = parts[name];
                const Icon = PART_ICONS[name];
                const swatch = paletteSwatch(parts.linked ? choice.color : value.color, parts.linked ? choice.palette : value.palette, value.original);
                return <button key={name} type="button" role="radio" aria-checked={part === name} onClick={() => setPart(name)}
                  className="flex min-w-0 flex-col items-center gap-1 rounded-sm border border-border bg-bg-tertiary px-1 py-2 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent aria-checked:border-accent aria-checked:text-text-primary">
                  <Icon aria-hidden className="h-4 w-4" />
                  <span className="truncate">{t(`foundry.movement.part.${name}`)}</span>
                  <span aria-hidden className={`h-2.5 w-8 rounded-full border ${value.original ? 'border-dashed border-text-secondary' : 'border-hl/15'}`} style={swatch} />
                </button>;
              })}
            </div>
            <IconButton size="sm" className="h-auto self-stretch" icon={parts.linked ? Link2 : Unlink2} aria-pressed={parts.linked}
              label={t(parts.linked ? 'foundry.movement.unlinkParts' : 'foundry.movement.linkParts')} onClick={() => setLinked(!parts.linked)} />
          </div>
          <Toggle label={t('foundry.movement.keepOriginal')} checked={!!selected?.original} disabled={!selected?.original && keepsEverything}
            onChange={setOriginal} />
        </fieldset>}
        {!selected?.original && <fieldset disabled={busy} className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-semibold text-text-primary">{t('foundry.movement.color')}</legend>
        <SegmentedControl fill value={target.palette.mode} onChange={(mode) => setTarget({
          palette: mode === 'gradient' ? { mode, end: '#65dfff' } : { mode } })} options={[
          { value: 'solid', label: t('foundry.movement.solid') },
          { value: 'gradient', label: t('foundry.movement.gradient') },
          { value: 'rainbow', label: t('foundry.movement.rainbow') },
        ]} />
        {target.palette.mode === 'gradient' && <div className="space-y-2">
          <div aria-hidden className="h-2 rounded-sm" style={{ background: `linear-gradient(to right, ${target.color}, ${target.palette.end})` }} />
          <div className="grid grid-cols-2 gap-2">
            {(['head', 'tail'] as const).map(stop => <button key={stop} type="button" aria-pressed={colorStop === stop}
              onClick={() => setColorStop(stop)} className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-2 py-2 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:text-text-primary">
              <span className="h-5 w-5 shrink-0 rounded-sm border border-hl/15" style={{ backgroundColor: stop === 'head' ? target.color : target.palette.mode === 'gradient' ? target.palette.end : target.color }} />
              {t(stop === 'head' ? 'foundry.movement.headColor' : 'foundry.movement.endColor')}
            </button>)}
          </div>
        </div>}
        <div inert={busy} className="px-2 [&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
          <HexColorPicker color={color} onChange={changeColor} style={{ width: '100%', height: 88 }} />
        </div>
        <label className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-2">
          <input type="color" aria-label={editingTail ? t('foundry.movement.endColor') : t('foundry.movement.color')} value={color}
            className="h-8 w-8 shrink-0 cursor-pointer border-0 bg-transparent" onChange={event => changeColor(event.target.value)} />
          <HexColorInput color={color} onChange={changeColor} prefixed aria-label={t('foundry.skin.hex')}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm uppercase tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </label>
        </fieldset>}
        {kind === 'dash' && <StampPicker disabled={busy} legend={t('foundry.movement.stamp')} originalLabel={t('foundry.movement.originalTrail')}
          value={choice.image} onChange={(image) => setChoice((old) => ({ ...old, image }))} emojiKey={`movement:${kind}:emoji`} onError={setError} />}
        {kind === 'parry' && part === 'shield' && <StampPicker disabled={busy} legend={t('foundry.movement.shieldImage')} originalLabel={t('foundry.movement.originalSymbol')}
          value={choice.image} onChange={(image) => setChoice((old) => ({ ...old, image }))} emojiKey="movement:parry:emoji" onError={setError} />}
        {kind === 'parry' && part === 'stun' && <StampPicker disabled={busy} legend={t('foundry.movement.stunImage')} originalLabel={t('foundry.movement.originalSymbol')}
          value={choice.stunImage} onChange={(stunImage) => setChoice((old) => ({ ...old, stunImage }))} emojiKey="movement:parry:stunEmoji" onError={setError} />}
        {kind !== 'heavy-melee' && <fieldset disabled={busy} className="min-w-0 space-y-2 border-t border-border pt-2">
          <legend className="pr-2 text-sm font-semibold text-text-primary">{t(kind === 'dash' ? 'foundry.movement.finish' : 'foundry.movement.effectFinish')}</legend>
          <label className="block space-y-2 text-xs text-text-secondary">
            <span className="flex justify-between"><span>{t('foundry.movement.brightness')}</span><span className="tabular-nums">{choice.brightness.toFixed(2)}×</span></span>
            <input type="range" className="w-full accent-accent" min={.25} max={4} step={.05} value={choice.brightness}
              aria-label={t('foundry.movement.brightness')} onChange={event => setChoice({ ...choice, brightness: Number(event.target.value) })} />
          </label>
          <Toggle label={t('foundry.movement.illuminated')} checked={choice.illuminated} onChange={illuminated => setChoice({ ...choice, illuminated })} />
          <div className="flex items-center justify-between gap-2">
            <Toggle label={t('foundry.movement.outline')} checked={choice.outline} disabled={!choice.image}
              onChange={outline => setChoice({ ...choice, outline })} />
            {choice.outline && choice.image && <input type="color" className="h-8 w-10 cursor-pointer bg-transparent"
              aria-label={t('foundry.movement.outlineColor')} value={choice.outlineColor}
              onChange={event => setChoice({ ...choice, outlineColor: event.target.value })} />}
          </div>
        </fieldset>}
        {kind === 'parry' && <section className="min-w-0 space-y-2 border-t border-border pt-2">
          <h3 className="text-sm font-semibold text-text-primary">{t('foundry.movement.parrySounds')}</h3>
          <SharedSoundSwaps sounds={PARRY_SOUNDS.map(({ labelKey, event, vsnd }) => ({ label: t(labelKey), event, vsnd: [...vsnd] }))} />
        </section>}
    </WorkshopWorkbench>
  </div>;
}

/** The original image, or an emoji or uploaded picture stamped in its place (dash trail, parry shield, stun icon). */
function StampPicker({ legend, originalLabel, value, onChange, emojiKey, onError, disabled }: {
  legend: string;
  originalLabel: string;
  value: string | null;
  onChange: (image: string | null) => void;
  /** Draft key remembering this picker's typed emoji. */
  emojiKey: string;
  onError: (message: string | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [emoji, setEmoji] = useFoundryDraft(emojiKey, z.string().max(32), '💀');
  const stamps = useMemo(() => EMOJIS.map(value => ({ value, image: emojiStamp(value) })), []);
  const fileInput = useRef<HTMLInputElement>(null);
  return <fieldset disabled={disabled} className="min-w-0 space-y-2 border-t border-border pt-2">
    <legend className="pr-2 text-sm font-semibold text-text-primary">{legend}</legend>
    <SegmentedControl fill value={value ? 'image' : 'original'} onChange={mode => onChange(mode === 'image' ? emojiStamp(emoji) : null)}
      options={[{ value: 'original', label: originalLabel }, { value: 'image', label: t('foundry.movement.imageTrail') }]} />
    {value && <>
      <div className="grid grid-cols-7 gap-1">{stamps.map(({ value: symbol, image }) => <button key={symbol} type="button" aria-label={symbol}
        aria-pressed={value === image}
        className="flex h-8 min-w-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-bg-tertiary text-xl hover:border-accent focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-accent/15"
        onClick={() => { setEmoji(symbol); onChange(image); }}>{symbol}</button>)}</div>
      <div className="flex gap-2">
        <Input inputSize="sm" value={emoji} maxLength={32} aria-label={t('foundry.movement.emoji')} onChange={(event) => setEmoji(event.target.value)} className="min-w-0 flex-1" />
        <Button size="sm" variant="secondary" disabled={!emoji.trim()} onClick={() => onChange(emojiStamp(emoji))}>{t('foundry.movement.useEmoji')}</Button>
      </div>
      <div className="flex items-center gap-3">
        <img src={value} alt={legend} className="h-9 w-9 shrink-0 rounded-sm border border-border bg-bg-tertiary object-contain" />
        <Button size="sm" variant="secondary" icon={Upload} className="flex-1" onClick={() => fileInput.current?.click()}>{t('foundry.movement.upload')}</Button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('foundry.movement.upload')} tabIndex={-1} className="sr-only" onChange={(event) => {
          const file = event.target.files?.[0]; if (!file) return;
          void imageStamp(file).then((image) => { onChange(image); onError(null); }).catch((reason: unknown) => onError(String(reason)));
          event.target.value = '';
        }} />
      </div>
    </>}
  </fieldset>;
}
