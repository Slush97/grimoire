import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ClipboardList, Fingerprint, Grid2x2, Grid3x3, LayoutGrid, List, SlidersHorizontal, SquareDashedX, Wand2, type LucideIcon } from 'lucide-react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Button, MultiSelectSegments } from '../common/ui';
import { InterchangeImportHost, InterchangeTransferActions } from '../interchange/ImportSourceMenu';

export interface InstalledOptionsMenuProps {
  layout: 'grid' | 'list';
  onLayoutChange: (layout: 'grid' | 'list') => void;
  cardSizeMultiplier: number;
  cardSizeRange: { min: number; max: number; step: number };
  onCardSizeChange: (value: number) => void;
  lockerOverrideCount: number;
  onLockerOverrides: () => void;
  showImprint: boolean;
  onImprint: () => void;
  canFixOrder: boolean;
  onFixOrder: () => void;
  canCopyEnabled: boolean;
  onCopyEnabled: () => void;
  onImported: () => void;
  onExport: () => void;
}

function OptionsAction({ icon, label, hint, disabled, count, onClick }: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  disabled?: boolean;
  count?: number;
  onClick: () => void;
}) {
  return <Button type="button" variant="ghost" icon={icon} title={hint} disabled={disabled}
    className="w-full justify-start !px-2 !text-xs !text-text-primary" onClick={onClick}>
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    {!!count && <span className="text-2xs tabular-nums text-text-secondary">{count}</span>}
  </Button>;
}

export function InstalledOptionsMenu({
  layout, onLayoutChange, cardSizeMultiplier, cardSizeRange, onCardSizeChange,
  lockerOverrideCount, onLockerOverrides, showImprint, onImprint, canFixOrder,
  onFixOrder, canCopyEnabled, onCopyEnabled, onImported, onExport,
}: InstalledOptionsMenuProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const act = (callback: () => void) => () => { close(); callback(); };

  return <InterchangeImportHost open={open} onDismiss={close} onImported={onImported}>{controller => <div ref={anchorRef} className="relative shrink-0">
    <button type="button" onClick={() => setOpen(value => !value)}
      aria-haspopup="dialog" aria-expanded={open} title={t('installed.options.title')}
      className="flex h-[38px] items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary transition-colors hover:bg-bg-tertiary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      <span>{t('installed.options.title')}</span>
      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
    </button>
    <AnchoredPopover open={open} onClose={close} anchorRef={anchorRef} width={288}
      ariaLabel={t('installed.options.title')} className="p-3">
      <div className="space-y-3 [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-border [&>div:not(:last-child)]:pb-3">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-secondary">{t('common.view')}</div>
            <MultiSelectSegments<'grid' | 'list'> label={t('common.view')} selected={[layout]}
              tone="neutral"
              multiselectable={false} onToggle={onLayoutChange} className="w-full" itemClassName="h-8 flex-1 px-2 text-xs"
              options={[
                { value: 'grid', label: t('conflicts.view.grid'), icon: LayoutGrid },
                { value: 'list', label: t('conflicts.view.list'), icon: List },
              ]} />
          </div>
          <div className={layout === 'list' ? 'opacity-45' : undefined}>
            <div className="mb-1.5 text-xs font-medium text-text-secondary">{t('installed.view.cardSize')}</div>
            <div className="flex items-center gap-2" title={t('installed.view.cardSizeHint')}>
              <Grid3x3 className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
              <input type="range" min={cardSizeRange.min} max={cardSizeRange.max} step={cardSizeRange.step}
                value={cardSizeMultiplier} disabled={layout === 'list'} onChange={event => onCardSizeChange(Number(event.currentTarget.value))}
                aria-label={t('installed.view.cardSize')} aria-valuetext={`${cardSizeMultiplier.toFixed(2)}x`}
                className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default" />
              <Grid2x2 className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
            </div>
            {layout === 'list' && <p className="mt-1.5 text-2xs text-text-secondary">{t('installed.view.cardSizeGridOnly')}</p>}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-text-secondary">{t('installed.options.library')}</div>
          <div className="space-y-1">
            <OptionsAction icon={Wand2} label={t('installed.actions.lockerOverrides')} hint={t('installed.actions.lockerOverridesHint')}
              count={lockerOverrideCount} onClick={act(onLockerOverrides)} />
            {showImprint && <OptionsAction icon={Fingerprint} label={t('installed.actions.imprintInstalledMods')}
              hint={t('installed.actions.imprintInstalledModsHint')} onClick={act(onImprint)} />}
            <OptionsAction icon={SquareDashedX} label={t('installed.actions.fixOrder')} hint={t('installed.actions.fixOrderHint')}
              disabled={!canFixOrder} onClick={act(onFixOrder)} />
            <OptionsAction icon={ClipboardList} label={t('installed.actions.copyEnabled')} hint={t('installed.actions.copyEnabledHint')}
              disabled={!canCopyEnabled} onClick={act(onCopyEnabled)} />
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-text-secondary">{t('installed.options.transfer')}</div>
          <InterchangeTransferActions controller={controller} onExport={onExport} />
        </div>
      </div>
    </AnchoredPopover>
  </div>}</InterchangeImportHost>;
}
