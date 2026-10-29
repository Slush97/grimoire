import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { Download, Upload, RotateCcw } from 'lucide-react';
import { Button, IconButton, SegmentedControl, Toggle } from '../common/ui';
import { Input } from '../common/forms';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useFoundryDraft } from '../../lib/useFoundryDraft';
import { movementFxSchema, type MovementFxChoice, type MovementFxPreview } from '../../lib/movementFx';
import { movementFxThumbnail } from '../../lib/movementFxThumbnail';
import { useAppStore } from '../../stores/appStore';
import type { HeroPoseSkinSource } from '../../types/portrait';
import { WorkshopWorkbench } from './WorkshopWorkbench';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
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

export default function MovementFxEditor({ heroName, skinSources }: { heroName: string; skinSources?: HeroPoseSkinSource[] }) {
  const { t } = useTranslation();
  const [kind, setKind] = useFoundryDraft('movement:kind', z.enum(['dash', 'heavy-melee']), 'dash');
  return <section className="@container space-y-3">
    <SegmentedControl value={kind} onChange={setKind} options={[
      { value: 'dash', label: t('foundry.movement.dash') }, { value: 'heavy-melee', label: t('foundry.movement.heavy-melee') },
    ]} />
    <MovementSession key={`${kind}:${heroName}`} kind={kind} heroName={heroName} skinSources={skinSources} />
  </section>;
}

function MovementSession({ kind, heroName, skinSources }: { kind: MovementFxChoice['kind']; heroName: string; skinSources?: HeroPoseSkinSource[] }) {
  const { t } = useTranslation();
  const initial: MovementFxChoice = { kind, color: '#ff70cf', palette: { mode: 'solid' }, image: null,
    brightness: 1, illuminated: false, outline: false, outlineColor: '#ffffff' };
  const [choice, setChoice] = useFoundryDraft(`movement:${kind}:choice`, movementFxSchema, initial);
  const [emoji, setEmoji] = useFoundryDraft(`movement:${kind}:emoji`, z.string().max(32), '💀');
  const [preview, setPreview] = useState<{ choice: MovementFxChoice; value: MovementFxPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<MovementFxChoice | null>(null);
  const [replay, setReplay] = useState(0);
  const [loop, setLoop] = useFoundryDraft('movement:loop', z.boolean(), true);
  const [colorStop, setColorStop] = useState<'head' | 'tail'>('head');
  const fileInput = useRef<HTMLInputElement>(null);
  const stamps = useMemo(() => EMOJIS.map(value => ({ value, image: emojiStamp(value) })), []);
  const [previewFailure, setPreviewFailure] = useState<{ choice: MovementFxChoice; message: string } | null>(null);
  const previewError = previewFailure?.choice === choice ? previewFailure.message : null;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      window.electronAPI.previewMovementFx({ choice, heroName }).then((value) => { if (!cancelled) setPreview({ choice, value }); })
        .catch((reason: unknown) => { if (!cancelled) setPreviewFailure({ choice, message: String(reason) }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [choice, heroName]);
  const apply = async (save: boolean) => {
    setBusy(true); setError(null); setSaved(null);
    try {
      if (save) { await window.electronAPI.saveMovementFx({ choice, thumbnailDataUrl: await movementFxThumbnail(choice) }); await useAppStore.getState().loadMods(); setSaved(choice); }
      else await window.electronAPI.exportMovementFx(choice);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const current = preview?.choice === choice;
  const editingTail = choice.palette.mode === 'gradient' && colorStop === 'tail';
  const color = editingTail && choice.palette.mode === 'gradient' ? choice.palette.end : choice.color;
  const changeColor = (value: string) => {
    const hex = value.replace('#', '');
    const next = `#${hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex}`;
    setChoice({ ...choice, ...(editingTail ? { palette: { mode: 'gradient', end: next } } : { color: next }) });
  };
  return <div className="space-y-3">
    <WorkshopWorkbench preview={<>
          <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-sm text-text-secondary">{t('foundry.skin.loading')}</p>}>
            <HeroPoseViewer heroName={heroName} skinSources={skinSources} workspaceKey={`movement:${heroName}`}
              initialScene="studio" initialBackground="none"
              movementPreview={preview ? { ...preview.value, kind, revision: replay, loop, request: { choice: preview.choice, heroName } } : undefined} />
          </Suspense></ErrorBoundary>
          {!current && !previewError && <p role="status" className="absolute left-3 top-3 rounded-sm bg-bg-secondary px-2 py-1 text-xs text-text-secondary">{t('foundry.movement.updating')}</p>}
        </>}
        previewFooter={<>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setReplay(v => v + 1)}>{t('foundry.movement.replay')}</Button>
          <Toggle label={t('foundry.movement.loop')} checked={loop} onChange={setLoop} />
        </>}
        footer={<>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-secondary">{t('foundry.movement.globalHint')}</p>
            <IconButton size="sm" icon={RotateCcw} label={t('foundry.movement.reset')} disabled={busy} onClick={() => { setChoice(initial); setError(null); }} />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" isLoading={busy} onClick={() => void apply(true)}>{t('foundry.skin.saveEnable')}</Button>
            <Button variant="secondary" icon={Download} disabled={busy} onClick={() => void apply(false)}>{t('foundry.movement.export')}</Button>
          </div>
        </>}>
        <fieldset disabled={busy} className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-semibold text-text-primary">{t('foundry.movement.color')}</legend>
        <SegmentedControl fill value={choice.palette.mode} onChange={(mode) => setChoice({ ...choice,
          palette: mode === 'gradient' ? { mode, end: '#65dfff' } : { mode } })} options={[
          { value: 'solid', label: t('foundry.movement.solid') },
          { value: 'gradient', label: t('foundry.movement.gradient') },
          { value: 'rainbow', label: t('foundry.movement.rainbow') },
        ]} />
        {choice.palette.mode === 'gradient' && <div className="space-y-2">
          <div aria-hidden className="h-2 rounded-sm" style={{ background: `linear-gradient(to right, ${choice.color}, ${choice.palette.end})` }} />
          <div className="grid grid-cols-2 gap-2">
            {(['head', 'tail'] as const).map(stop => <button key={stop} type="button" aria-pressed={colorStop === stop}
              onClick={() => setColorStop(stop)} className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-2 py-2 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:text-text-primary">
              <span className="h-5 w-5 shrink-0 rounded-sm border border-hl/15" style={{ backgroundColor: stop === 'head' ? choice.color : choice.palette.mode === 'gradient' ? choice.palette.end : choice.color }} />
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
        </fieldset>
        {kind === 'dash' && <fieldset disabled={busy} className="min-w-0 space-y-2 border-t border-border pt-2">
          <legend className="pr-2 text-sm font-semibold text-text-primary">{t('foundry.movement.stamp')}</legend>
          <SegmentedControl fill value={choice.image ? 'image' : 'original'} onChange={value => setChoice({ ...choice, image: value === 'image' ? emojiStamp(emoji) : null })}
            options={[{ value: 'original', label: t('foundry.movement.originalTrail') }, { value: 'image', label: t('foundry.movement.imageTrail') }]} />
          {choice.image && <>
          <div className="grid grid-cols-7 gap-1">{stamps.map(({ value, image }) => <button key={value} type="button" aria-label={value}
            aria-pressed={choice.image === image}
            className="flex h-8 min-w-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-bg-tertiary text-xl hover:border-accent focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-accent/15"
            onClick={() => { setEmoji(value); setChoice({ ...choice, image }); }}>{value}</button>)}</div>
          <div className="flex gap-2">
            <Input inputSize="sm" value={emoji} maxLength={32} aria-label={t('foundry.movement.emoji')} onChange={(event) => setEmoji(event.target.value)} className="min-w-0 flex-1" />
            <Button size="sm" variant="secondary" disabled={!emoji.trim()} onClick={() => setChoice({ ...choice, image: emojiStamp(emoji) })}>{t('foundry.movement.useEmoji')}</Button>
          </div>
          <div className="flex items-center gap-3">
            <img src={choice.image} alt={t('foundry.movement.stamp')} className="h-9 w-9 shrink-0 rounded-sm border border-border bg-bg-tertiary object-contain" />
            <Button size="sm" variant="secondary" icon={Upload} className="flex-1" onClick={() => fileInput.current?.click()}>{t('foundry.movement.upload')}</Button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('foundry.movement.upload')} tabIndex={-1} className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0]; if (!file) return;
              void imageStamp(file).then((image) => { setChoice((old) => ({ ...old, image })); setError(null); }).catch((reason: unknown) => setError(String(reason)));
              event.target.value = '';
            }} />
          </div>
          </>}
        </fieldset>}
        {kind === 'dash' && <fieldset disabled={busy} className="min-w-0 space-y-2 border-t border-border pt-2">
          <legend className="pr-2 text-sm font-semibold text-text-primary">{t('foundry.movement.finish')}</legend>
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
    </WorkshopWorkbench>
    {saved === choice && <p role="status" className="text-xs text-state-success">{t('foundry.movement.saved')}</p>}
    {(error || previewError) && <p role="alert" className="text-sm text-state-danger">{error || previewError}</p>}
  </div>;
}
