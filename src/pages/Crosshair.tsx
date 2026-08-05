import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, RotateCcw, Pin, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { useCrosshairStore } from '../stores/crosshairStore';
import CrosshairStage from '../components/crosshair/CrosshairStage';
import { STAGE_BACKGROUNDS, type StageBackground } from '../components/crosshair/stageBackgrounds';
import CrosshairControls from '../components/crosshair/CrosshairControls';
import CrosshairPresetRail from '../components/crosshair/CrosshairPresetRail';
import { renderCrosshairThumbnail } from '../components/crosshair/drawCrosshair';
import { getSettings } from '../lib/api';
import { Button, SegmentedControl } from '../components/common/ui';
import { PageHeader } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';

// The in-game crosshair is authored in 1080p-reference px and scaled by
// screen height, so the preview multiplies by (resolution / 1080).
const RESOLUTIONS = [
    { label: '1080p', height: 1080 },
    { label: '1440p', height: 1440 },
    { label: '4K', height: 2160 },
];

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];

function detectResolutionHeight(): number {
    const h = window.screen.height * (window.devicePixelRatio || 1);
    if (h >= 2160) return 2160;
    if (h >= 1440) return 1440;
    return 1080;
}

export default function Crosshair() {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const [imported, setImported] = useState(false);
    const [resolution, setResolution] = useState(detectResolutionHeight);
    const [zoom, setZoom] = useState(1);
    const [background, setBackground] = useState<StageBackground>('street');
    const [gamePath, setGamePath] = useState<string | null>(null);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);

    const {
        reset,
        generateCommands,
        getSettings: getCrosshairSettings,
        importFromGame,
        presets,
        activePresetId,
        loadPresets,
        savePreset,
        deletePreset,
        applyPreset,
        loadSettingsFromPreset,
        clearAutoexec,
    } = useCrosshairStore();

    // Load presets and game path on mount
    useEffect(() => {
        loadPresets();
        getSettings().then((settings) => setGamePath(settings.deadlockPath));
        window.electronAPI.getAlwaysOnTop().then(setAlwaysOnTop);
    }, [loadPresets]);

    const handleAlwaysOnTop = async (enabled: boolean) => {
        const result = await window.electronAPI.setAlwaysOnTop(enabled);
        setAlwaysOnTop(result);
    };

    const handleCopy = async () => {
        // One line, ';'-separated, so a single paste into the in-game console
        // (which only takes the first line) applies every command.
        const commands = generateCommands().split('\n').join('; ');
        await navigator.clipboard.writeText(commands);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleImportFromGame = async () => {
        if (!gamePath) {
            alert(t('crosshair.alert.configureGamePath'));
            return;
        }
        try {
            const found = await importFromGame(gamePath);
            if (found) {
                setImported(true);
                setTimeout(() => setImported(false), 2000);
            } else {
                alert(t('crosshair.alert.noSettingsFound'));
            }
        } catch (error) {
            console.error('Failed to import crosshair from game:', error);
            alert(t('crosshair.alert.readConfigFailed'));
        }
    };

    // Deliberately lets a failure propagate: the rail keeps the name field open
    // so the save can be retried. Swallowing it here would let the rail treat a
    // failed write as a success and clear what the user typed.
    const handleSavePreset = async (name: string) => {
        const thumbnail = renderCrosshairThumbnail(getCrosshairSettings());
        await savePreset(name, thumbnail);
    };

    const handleApplyPreset = async (presetId: string) => {
        if (!gamePath) {
            alert(t('crosshair.alert.configureGamePath'));
            return;
        }
        try {
            await applyPreset(presetId, gamePath);
        } catch (error) {
            console.error('Failed to apply preset:', error);
            alert(t('crosshair.alert.applyPresetFailed'));
        }
    };

    const handleDeletePreset = async (presetId: string) => {
        if (!confirm(t('crosshair.confirm.deletePreset'))) return;
        const wasActive = presetId === activePresetId;
        if (wasActive && gamePath) {
            try {
                await clearAutoexec(gamePath);
            } catch (error) {
                console.error('Failed to clear crosshair from autoexec:', error);
            }
        }
        await deletePreset(presetId);
    };

    const handleClearActive = async () => {
        if (!gamePath) {
            alert(t('crosshair.alert.configureGamePath'));
            return;
        }
        if (!confirm(t('crosshair.confirm.clearActive'))) return;
        try {
            await clearAutoexec(gamePath);
        } catch (error) {
            console.error('Failed to clear crosshair:', error);
            alert(t('crosshair.alert.clearFailed'));
        }
    };

    const stepZoom = (dir: -1 | 1) => {
        const i = ZOOM_STEPS.indexOf(zoom);
        const next = i === -1 ? 1 : Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir));
        setZoom(ZOOM_STEPS[next]);
    };

    return (
        // Stage-first: the preview is the page, the controls sit beside it, and
        // nothing that changes the crosshair is more than a tab away. Below xl
        // the two stack and the page scrolls as one.
        <div className="flex min-h-full flex-col gap-4 p-6 xl:h-full xl:min-h-0">
            <PageHeader
                title={<Tx k="nav.crosshair" fallback="Crosshair" />}
                description={
                    <Tx
                        k="crosshair.header.description"
                        fallback="Tune your crosshair and read it against a real scene"
                    />
                }
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" onClick={reset} icon={RotateCcw} size="sm">
                            <Tx k="common.actions.reset" fallback="Reset" />
                        </Button>
                        <Button
                            variant={imported ? 'success' : 'secondary'}
                            onClick={handleImportFromGame}
                            icon={imported ? Check : Download}
                            size="sm"
                            title={t('crosshair.actions.importTitle')}
                        >
                            {imported ? (
                                <Tx k="crosshair.status.imported" fallback="Imported" />
                            ) : (
                                <Tx k="crosshair.actions.importFromGame" fallback="Import from Game" />
                            )}
                        </Button>
                        <Button
                            variant={alwaysOnTop ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => handleAlwaysOnTop(!alwaysOnTop)}
                            icon={Pin}
                            title={t('crosshair.preview.pinTitle')}
                        >
                            {alwaysOnTop ? (
                                <Tx k="crosshair.preview.pinned" fallback="Pinned" />
                            ) : (
                                <Tx k="crosshair.preview.pinWindow" fallback="Pin Window" />
                            )}
                        </Button>
                        <Button
                            variant={copied ? 'success' : 'primary'}
                            onClick={handleCopy}
                            icon={copied ? Check : Copy}
                            size="sm"
                            title={t('crosshair.hints.pressF7')}
                        >
                            {copied ? (
                                <Tx k="common.status.copied" fallback="Copied" />
                            ) : (
                                <Tx k="crosshair.actions.copyCode" fallback="Copy Code" />
                            )}
                        </Button>
                    </div>
                }
            />

            <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
                {/* Stage column */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
                    {/* Below xl the column has no definite height, so the stage
                        gets an explicit viewport-relative one that shrinks with
                        the window instead of collapsing. From xl it goes back to
                        taking whatever the row leaves over. */}
                    <div className="relative h-[clamp(220px,42vh,560px)] overflow-hidden rounded-sm border border-hl/5 xl:h-auto xl:min-h-[280px] xl:flex-1">
                        <CrosshairStage scale={(resolution / 1080) * zoom} background={background} />

                        {/* Both overlay bars share one wrapping row so they move
                            onto separate lines on a narrow window instead of
                            growing into each other. The wrapper ignores the
                            pointer, so only the chips themselves interrupt the
                            crosshair's tracking, not the empty span between. */}
                        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
                            {/* Scene picker. Thumbnails rather than words: you're
                                choosing an image, so show the image. */}
                            <div className="pointer-events-auto flex items-center gap-1.5 rounded-sm border border-white/10 bg-black/50 p-1.5 backdrop-blur-md">
                                {STAGE_BACKGROUNDS.map((b) => {
                                    const active = b.id === background;
                                    return (
                                        <button
                                            key={b.id}
                                            type="button"
                                            onClick={() => setBackground(b.id)}
                                            aria-pressed={active}
                                            title={t(`crosshair.preview.backgrounds.${b.id}`)}
                                            aria-label={t(`crosshair.preview.backgrounds.${b.id}`)}
                                            className={`h-8 w-12 cursor-pointer overflow-hidden rounded-sm border bg-bg-tertiary bg-cover bg-center transition-colors ${
                                                active ? 'border-accent ring-1 ring-accent' : 'border-hl/15 hover:border-hl/40'
                                            }`}
                                            style={b.src ? { backgroundImage: `url(${b.src})` } : undefined}
                                        >
                                            {!b.src && (
                                                <span className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-text-secondary">
                                                    {t('crosshair.preview.backgrounds.plain')}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Resolution + zoom. Stepped zoom instead of a fiddly
                                80px track: the useful values are few and discrete. */}
                            <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-black/50 px-2 py-1.5 backdrop-blur-md">
                                <SegmentedControl
                                    options={RESOLUTIONS.map((r) => ({ value: String(r.height), label: r.label }))}
                                    value={String(resolution)}
                                    onChange={(v) => setResolution(parseInt(v, 10))}
                                    label={t('crosshair.preview.resolutionTitle')}
                                />
                                <div className="flex items-center gap-1 border-l border-hl/10 pl-2">
                                    <button
                                        type="button"
                                        onClick={() => stepZoom(-1)}
                                        disabled={zoom === ZOOM_STEPS[0]}
                                        className="cursor-pointer rounded-sm p-1 text-text-secondary transition-colors hover:bg-hl/10 hover:text-text-primary disabled:cursor-default disabled:opacity-40"
                                        title={t('crosshair.preview.zoomOut')}
                                        aria-label={t('crosshair.preview.zoomOut')}
                                    >
                                        <ZoomOut className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setZoom(1)}
                                        className="w-10 cursor-pointer rounded-sm py-1 text-center font-mono text-xs text-text-primary transition-colors hover:bg-hl/10"
                                        title={t('crosshair.preview.resetZoom')}
                                    >
                                        {zoom}x
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => stepZoom(1)}
                                        disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                                        className="cursor-pointer rounded-sm p-1 text-text-secondary transition-colors hover:bg-hl/10 hover:text-text-primary disabled:cursor-default disabled:opacity-40"
                                        title={t('crosshair.preview.zoomIn')}
                                        aria-label={t('crosshair.preview.zoomIn')}
                                    >
                                        <ZoomIn className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <CrosshairPresetRail
                        presets={presets}
                        activePresetId={activePresetId}
                        onLoad={loadSettingsFromPreset}
                        onApply={handleApplyPreset}
                        onDelete={handleDeletePreset}
                        onSave={handleSavePreset}
                        onClearActive={handleClearActive}
                    />
                </div>

                {/* Controls column */}
                <div className="flex min-h-0 w-full shrink-0 flex-col xl:w-[360px]">
                    <CrosshairControls />
                </div>
            </div>
        </div>
    );
}
