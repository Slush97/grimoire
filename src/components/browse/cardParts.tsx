import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Eye, ThumbsUp, Clock, Power } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GameBananaMod } from '../../types/gamebanana';
import { isModOutdated } from '../../types/gamebanana';
import { IconText } from '../common/IconText';
import { formatAbsoluteDate, formatRelativeDate } from '../../lib/dates';
import type { BrowseReadableDensity } from './cardGeometry';
import { formatCount, usePrefersReducedMotion } from './cardUtils';

function gameBananaTimestampToIso(timestamp: number | undefined): string | null {
  if (!timestamp || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function BrowseReadableUpdatedLine({
  timestamp,
  variant = 'inline',
}: {
  timestamp?: number;
  /** `inline` sits in the stats row; `block` is its own line under the author
   *  (used on narrow cards where the stats row has no room for it). */
  variant?: 'inline' | 'block';
}) {
  const iso = gameBananaTimestampToIso(timestamp);
  const relative = iso ? formatRelativeDate(iso).replace(/(\d+)\s+(mo|yr)\s+ago/g, '$1$2 ago') : null;
  const absolute = iso ? formatAbsoluteDate(iso) : null;
  const isOutdated = typeof timestamp === 'number' && timestamp > 0 && isModOutdated(timestamp);

  if (!relative) return null;

  const title = absolute ? `${isOutdated ? 'Outdated. ' : ''}Last updated on GameBanana: ${absolute}` : undefined;

  if (variant === 'block') {
    return (
      <p
        className={`mt-1 truncate text-[clamp(9px,3.5714cqw,11px)] font-normal leading-[1.05] ${
          isOutdated ? 'text-state-warning/85' : 'text-text-tertiary/75'
        }`}
        title={title}
      >
        ↻ {relative}
      </p>
    );
  }

  return (
    <span
      className={`inline-flex min-w-0 shrink items-center gap-0.5 truncate font-normal leading-none ${
        isOutdated ? 'text-state-warning/85' : 'text-text-tertiary/75'
      }`}
      title={title}
    >
      ↻ {relative}
    </span>
  );
}

export function BrowseArtParallaxCard({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const effectDisabled = disabled || prefersReducedMotion;

  const resetParallax = useCallback(() => {
    const element = cardRef.current;
    if (!element) return;

    element.style.setProperty('--browse-art-x', '0px');
    element.style.setProperty('--browse-art-y', '0px');
    element.style.setProperty('--browse-art-rotate', '0deg');
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (effectDisabled || event.pointerType !== 'mouse') return;

    const element = cardRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const moveX = (0.5 - x) * 4;
    const moveY = (0.5 - y) * 4;
    const rotate = (x - 0.5) * 0.2;

    element.style.setProperty('--browse-art-x', `${moveX.toFixed(2)}px`);
    element.style.setProperty('--browse-art-y', `${moveY.toFixed(2)}px`);
    element.style.setProperty('--browse-art-rotate', `${rotate.toFixed(2)}deg`);
  }, [effectDisabled]);

  useEffect(() => {
    if (effectDisabled) resetParallax();
  }, [effectDisabled, resetParallax]);

  return (
    <div
      ref={cardRef}
      className="browse-art-parallax-card group relative w-full"
      data-parallax-disabled={effectDisabled ? 'true' : undefined}
      onPointerMove={handlePointerMove}
      onPointerCancel={resetParallax}
      onPointerLeave={resetParallax}
    >
      {children}
    </div>
  );
}

export function BrowseStatItem({
  type,
  icon,
  value,
  title,
  align = 'start',
  emphasis = 'muted',
}: {
  type: 'likes' | 'views' | 'downloads';
  icon: LucideIcon;
  value: string;
  title: string;
  align?: 'start' | 'center' | 'end';
  emphasis?: 'muted' | 'strong';
}) {
  const alignmentClass =
    align === 'center' ? 'browse-stat-item--center' : align === 'end' ? 'browse-stat-item--end' : 'browse-stat-item--start';

  return (
    <IconText
      icon={icon}
      className={`browse-stat-item ${alignmentClass}`}
      title={title}
      iconClassName={`browse-stat-icon browse-stat-icon--${type}${emphasis === 'strong' ? ' browse-stat-icon--strong' : ''}`}
      valueClassName="browse-stat-value"
    >
      {value}
    </IconText>
  );
}

export function BrowseReadableStatsRow({ mod, density, showUpdated }: { mod: GameBananaMod; density: BrowseReadableDensity; showUpdated: boolean }) {
  const isMicro = density === 'micro';
  const groupClass = isMicro
    ? 'grid w-full grid-cols-2 items-center text-[clamp(11px,4.3cqw,13px)] font-semibold text-text-tertiary/85'
    : 'flex h-5 min-w-0 flex-1 items-center gap-[clamp(5px,2.5cqw,10px)] text-[clamp(11px,4.3cqw,13px)] font-semibold text-text-tertiary/85';
  const itemEmphasis = isMicro ? 'strong' : 'muted';

  return (
    <div className={groupClass}>
      <BrowseStatItem
        type="likes"
        icon={ThumbsUp}
        value={formatCount(mod.likeCount)}
        title={`${mod.likeCount ?? 0} likes`}
        align="start"
        emphasis={itemEmphasis}
      />
      <BrowseStatItem
        type="views"
        icon={Eye}
        value={formatCount(mod.viewCount)}
        title={`${mod.viewCount ?? 0} views`}
        align="start"
        emphasis={itemEmphasis}
      />
      {showUpdated && <BrowseReadableUpdatedLine timestamp={mod.dateModified} variant="inline" />}
    </div>
  );
}

export function BrowseSoundPlaceholder({ title }: { title: string }) {
  const bars = [22, 38, 54, 30, 68, 46, 34, 58, 26, 42, 62, 36, 48, 28];

  return (
    <div
      className="browse-sound-placeholder absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_24%_22%,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(96,165,250,0.16),transparent_28%),linear-gradient(135deg,#151312,#22242a_55%,#121416)]"
      role="img"
      aria-label={`${title} audio preview`}
    >
      <div className="absolute inset-x-8 top-[46%] flex h-12 -translate-y-1/2 items-center justify-center gap-1.5 opacity-35">
        {bars.map((height, index) => (
          <span
            key={`${title}-wave-${index}`}
            className="browse-sound-wave-bar w-1 rounded-full bg-text-secondary"
            style={{ height: `${height}%`, animationDelay: `${index * 38}ms` }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-primary/55 to-transparent" />
    </div>
  );
}

/**
 * Compositor-only download indicator for cards. The old stroked SVG spinner
 * could look stepped at these tiny sizes; this keeps a quiet track underneath
 * a continuous orbit and never depends on React progress renders to move.
 */
export function BrowseDownloadSpinner({
  className = '',
  size = 'default',
}: {
  className?: string;
  size?: 'default' | 'large';
}) {
  return (
    <span
      aria-hidden="true"
      className={`browse-download-spinner ${size === 'large' ? 'browse-download-spinner--large' : ''} ${className}`}
    />
  );
}

export function BrowseReadableAction({
  modName,
  installed,
  installedDisabled,
  downloading,
  queuePosition,
  density,
  iconOnlyOverride,
  onQuickDownload,
  onEnable,
}: {
  modName: string;
  installed: boolean;
  installedDisabled?: boolean;
  downloading: boolean;
  queuePosition?: number;
  density: BrowseReadableDensity;
  iconOnlyOverride?: boolean;
  onQuickDownload: (anchor?: HTMLElement) => void;
  onEnable?: () => void;
}) {
  const { t } = useTranslation();
  const actionableEnable = installed && installedDisabled && !!onEnable;
  const action = actionableEnable
    ? 'enable'
    : installed
      ? 'installed'
      : downloading
        ? 'downloading'
        : queuePosition
          ? 'queued'
          : 'install';
  const label =
    action === 'enable'
      ? t('browse.card.enable')
      : action === 'installed'
        ? t('nav.installed')
        : action === 'downloading'
          ? 'Loading'
          : action === 'queued'
            ? `Queued ${queuePosition}`
            : t('browse.card.install');
  const iconOnly = iconOnlyOverride ?? density === 'micro';
  const className = iconOnly
    ? `browse-action-button browse-action-button--icon browse-action-button--${action}`
    : `browse-action-button browse-action-button--${action}`;
  const previousActionRef = useRef(action);
  const previousQueuePositionRef = useRef(queuePosition);
  const [completionPulse, setCompletionPulse] = useState(false);
  const [queueShift, setQueueShift] = useState(false);

  useEffect(() => {
    const previousAction = previousActionRef.current;
    const completedFromPending =
      (action === 'installed' || action === 'enable') &&
      (previousAction === 'downloading' || previousAction === 'queued');

    if (completedFromPending) {
      previousActionRef.current = action;
      let endTimeout: number | null = null;
      const startTimeout = window.setTimeout(() => {
        setCompletionPulse(true);
        endTimeout = window.setTimeout(() => setCompletionPulse(false), 620);
      }, 0);
      return () => {
        window.clearTimeout(startTimeout);
        if (endTimeout !== null) window.clearTimeout(endTimeout);
      };
    }

    previousActionRef.current = action;
    return undefined;
  }, [action]);

  useEffect(() => {
    const previousQueuePosition = previousQueuePositionRef.current;
    if (
      typeof queuePosition === 'number' &&
      typeof previousQueuePosition === 'number' &&
      queuePosition !== previousQueuePosition
    ) {
      previousQueuePositionRef.current = queuePosition;
      let endTimeout: number | null = null;
      const startTimeout = window.setTimeout(() => {
        setQueueShift(true);
        endTimeout = window.setTimeout(() => setQueueShift(false), 260);
      }, 0);
      return () => {
        window.clearTimeout(startTimeout);
        if (endTimeout !== null) window.clearTimeout(endTimeout);
      };
    }

    previousQueuePositionRef.current = queuePosition;
    return undefined;
  }, [queuePosition]);

  const motionClassName = [
    className,
    completionPulse ? 'browse-action-button--complete-pop' : '',
    queueShift ? 'browse-action-button--queue-shift' : '',
  ].filter(Boolean).join(' ');
  const icon =
    action === 'installed'
        ? Check
        : action === 'enable'
          ? Power
          : action === 'queued'
            ? Clock
            : Download;
  const content = (
    iconOnly ? (
      <span className={`browse-action-button-icon browse-action-button-icon--${action}`}>
        {action === 'downloading'
          ? <BrowseDownloadSpinner />
          : React.createElement(icon, { 'aria-hidden': true })}
      </span>
    ) : (
      <>
        <span className={`browse-action-button-icon browse-action-button-icon--${action}`}>
          {action === 'downloading'
            ? <BrowseDownloadSpinner />
            : React.createElement(icon, { 'aria-hidden': true })}
        </span>
        <span className="browse-action-button-label">
          {action === 'queued' ? (
            <span key={queuePosition} className="browse-action-button-queue-value">{label}</span>
          ) : (
            label
          )}
        </span>
      </>
    )
  );

  if (action === 'install') {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onQuickDownload(event.currentTarget); }}
        className={`${motionClassName} cursor-pointer`}
        title={`Install ${modName}`}
        aria-label={`Install ${modName}`}
      >
        {content}
      </button>
    );
  }

  if (action === 'enable' && onEnable) {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onEnable(); }}
        className={`${motionClassName} cursor-pointer`}
        title={t('browse.actions.enableDisabledTitle')}
        aria-label={t('browse.card.enableNamed', { name: modName })}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`${motionClassName} cursor-default`} title={label} aria-label={`${label} ${modName}`}>
      {content}
    </span>
  );
}
