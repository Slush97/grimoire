import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, Input } from '../common/forms';
import { ModalBody, ModalFooter } from '../common/Modal';
import { Button } from '../common/ui';
import type { PerformancePresetSummary } from '../../types/electron';
import type { PerformanceRepositoryInspection } from '../../types/performanceCustom';
import { suggestedPerformanceVideoPath } from '../../lib/performanceRepository';
import PerformancePresetError from './PerformancePresetError';

const repositoryExamples = [
  'Sqooky/OptimizationLock', 'dacooderr/OptiLock', 'haloshiroe/complock-mirror',
  '7liv/compylock', 'Sladk1y7/Deadlock-optimization-Sqooky-s-addons_custom',
  'Blxnkt/FPS-Config-Deadlock-September-29', 'awesking/aweskings-dl-config',
  'SodiumCXI/deadlock-smooth-config', 'Apollyam/deadlock-config', 'Shabob1/Deadlock-Tweaks-config',
];

function firstConfig(source: PerformanceRepositoryInspection | null) {
  return source?.configPaths.length === 1 ? source.configPaths[0] : '';
}
function initialVideo(source: PerformanceRepositoryInspection | null) {
  if (!source || (source.configPaths.length > 1)) return undefined;
  const suggested = suggestedPerformanceVideoPath(firstConfig(source) || null, source.videoPaths);
  return suggested === null ? '' : suggested;
}
function presetName(source: PerformanceRepositoryInspection | null, path: string, video: string | undefined) {
  if (!source) return '';
  const parts = (path || video || '').split('/');
  const filename = parts.pop() ?? '';
  const folder = parts.at(-1);
  const base = folder && folder !== 'cfg' ? folder : source.repository.split('/')[1];
  const variant = /^video\(.+\)\.txt$/i.test(video?.split('/').at(-1) ?? '')
    ? video!.split('/').at(-1)!.replace(/^video\(|\)\.txt$/gi, '') : '';
  const configVariant = filename && !/^(?:gameinfo\.(?:gi|txt)|video.*\.txt)$/i.test(filename) ? filename.replace(/\.[^.]+$/, '') : '';
  return [base, configVariant, variant].filter(Boolean).join(' · ').slice(0, 100);
}

interface Props {
  initialInspection: PerformanceRepositoryInspection | null;
  presets: PerformancePresetSummary[];
  onInspected: (source: PerformanceRepositoryInspection | null) => void;
  onImported: (preset: PerformancePresetSummary) => Promise<void>;
  onBack: () => void;
  onBusy: (busy: boolean) => void;
}

export default function CustomPresetImport({ initialInspection, presets, onInspected, onImported, onBack, onBusy }: Props) {
  const { t } = useTranslation();
  const formId = useId();
  const sourceRef = useRef<HTMLDivElement>(null);
  const [repository, setRepository] = useState(initialInspection?.repository ?? '');
  const [inspection, setInspection] = useState(initialInspection);
  const [configPath, setConfigPath] = useState(firstConfig(initialInspection));
  const [videoPath, setVideoPath] = useState<string | undefined>(() => initialVideo(initialInspection));
  const [videoOnly, setVideoOnly] = useState(!!initialInspection && !initialInspection.configPaths.length);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const baseName = presetName(inspection, configPath, videoPath);
  let suggestedName = baseName;
  for (let number = 2; presets.some((preset) => preset.name === suggestedName); number++) suggestedName = `${baseName.slice(0, 90)} (${number})`;
  const displayName = name ?? suggestedName;
  const existing = presets.filter((preset) => preset.upstream.repo === inspection?.repository && preset.upstream.commit === inspection?.commit);
  const hasFiles = !!inspection && !!(inspection.configPaths.length || inspection.videoPaths.length);
  const configFolder = configPath.replace(/[^/]+$/, '');
  const nearbyVideos = inspection?.videoPaths.filter((path) => {
    const parent = path.replace(/[^/]+$/, '');
    return videoOnly || parent === configFolder || parent === `${configFolder}cfg/`;
  }) ?? [];
  const otherVideos = inspection?.videoPaths.filter((path) => !nearbyVideos.includes(path)) ?? [];
  const canImport = !!inspection && (!!configPath || videoOnly) && videoPath !== undefined &&
    (!!configPath || !!videoPath) && !!displayName.trim();

  useEffect(() => { if (inspection) sourceRef.current?.focus(); }, [inspection]);

  const run = async (action: 'inspect' | 'import', task: () => Promise<void>) => {
    if (busy) return;
    setBusy(action); onBusy(true); setError(null);
    try { await task(); }
    catch (err) { setError(err); }
    finally { setBusy(null); onBusy(false); }
  };
  const inspect = (repo: string) => run('inspect', async () => {
    const source = await window.electronAPI.inspectPerformanceRepository(repo);
    setInspection(source); onInspected(source); setRepository(source.repository);
    const config = firstConfig(source);
    setConfigPath(config); setVideoOnly(!source.configPaths.length);
    setVideoPath(initialVideo(source));
    setName(null);
  });
  const chooseConfig = (path: string) => {
    setConfigPath(path); setVideoOnly(!path); setError(null);
    const suggested = suggestedPerformanceVideoPath(path || null, inspection!.videoPaths);
    setVideoPath(suggested === null ? '' : suggested);
  };
  const changeSource = () => { setInspection(null); onInspected(null); setError(null); setName(null); };
  const choice = (path: string, kind: 'config' | 'video') => (
    <label key={path} className="flex cursor-pointer items-start gap-3 rounded-sm px-3 py-2 hover:bg-hl/5">
      <input type="radio" name={`${formId}-${kind}`} value={path} checked={kind === 'config' ? !videoOnly && configPath === path : videoPath === path}
        disabled={!!busy} className="mt-1 shrink-0 accent-accent" onChange={() => kind === 'config' ? chooseConfig(path) : (setVideoPath(path), setError(null))} />
      <span className="min-w-0 break-words font-mono text-xs text-text-primary">{path}</span>
      {existing.some((preset) => (kind === 'config' ? preset.custom?.configPath : preset.custom?.videoPath) === path) &&
        <span className="ml-auto shrink-0 text-xs text-text-secondary">{t('performance.custom.alreadyAdded')}</span>}
    </label>
  );

  return <>
    <ModalBody className="space-y-4">
      <form id={formId} className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!inspection) { if (repository.trim()) void inspect(repository); return; }
        if (!canImport) return;
        void run('import', async () => {
          const imported = await window.electronAPI.importPerformancePreset({
            repository: inspection.repository, commit: inspection.commit, name: displayName.trim(),
            configPath: configPath || null, videoPath: videoPath || null,
          });
          await onImported(imported);
        });
      }}>
        {!inspection ? <>
          <FormField label={t('performance.custom.repository')} hint={t('performance.custom.repositoryHint')}>
            <Input autoFocus value={repository} onChange={(event) => { setRepository(event.target.value); setError(null); }} required disabled={!!busy} />
          </FormField>
          {error !== null && <PerformancePresetError error={error} />}
          <details>
            <summary className="cursor-pointer text-sm text-text-secondary">{t('performance.custom.examples')}</summary>
            <div className="mt-2 max-h-60 overflow-y-auto">
              {repositoryExamples.map((repo) => <Button key={repo} type="button" variant="ghost" disabled={!!busy}
                className="h-auto w-full justify-start whitespace-normal break-all py-2 text-left" onClick={() => { setRepository(repo); void inspect(repo); }}>{repo}</Button>)}
            </div>
          </details>
        </> : <>
          <div ref={sourceRef} tabIndex={-1} className="flex items-start justify-between gap-3 outline-none">
            <div className="min-w-0">
              <a href={`https://github.com/${inspection.repository}/tree/${inspection.commit}`} target="_blank" rel="noreferrer noopener" className="break-words text-sm text-accent hover:underline">{inspection.repository}</a>
              <p className="mt-1 text-xs text-text-secondary">{t('performance.custom.sourceRevision', { commit: inspection.commit.slice(0, 8), date: inspection.date })}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={changeSource}>{t('performance.custom.changeSource')}</Button>
          </div>
          {inspection.repository === 'haloshiroe/complock-mirror' && <p className="text-xs text-text-secondary">{t('performance.custom.mirrorExample')}</p>}
          {inspection.repository === 'Shabob1/Deadlock-Tweaks-config' && <p className="text-xs text-text-secondary">{t('performance.custom.videoOnlyExample')}</p>}
          {!hasFiles ? <p role="status" className="text-sm text-text-secondary">{t('performance.custom.noConfigs')}</p> : <>
            {inspection.configPaths.length > 0 && <fieldset>
              <legend className="mb-2 text-sm text-text-primary">{t('performance.custom.path')}</legend>
              <div className="max-h-60 overflow-y-auto rounded-sm border border-border">
                {inspection.configPaths.map((path) => choice(path, 'config'))}
                {inspection.videoPaths.length > 0 && <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm text-text-secondary">
                  <input type="radio" name={`${formId}-config`} checked={videoOnly} disabled={!!busy} className="mt-1 accent-accent" onChange={() => chooseConfig('')} />
                  {t('performance.custom.videoOnly')}
                </label>}
              </div>
              {!configPath && !videoOnly && <p className="mt-2 text-xs text-text-secondary">{t('performance.custom.chooseConfig')}</p>}
            </fieldset>}
            {(!!configPath || videoOnly) && inspection.videoPaths.length > 0 && <fieldset>
              <legend className="mb-2 text-sm text-text-primary">{t('performance.custom.videoPath')}</legend>
              <div className="max-h-48 overflow-y-auto rounded-sm border border-border">
                {nearbyVideos.map((path) => choice(path, 'video'))}
                {!!configPath && <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm text-text-secondary">
                  <input type="radio" name={`${formId}-video`} checked={videoPath === ''} disabled={!!busy} className="mt-1 accent-accent" onChange={() => { setVideoPath(''); setError(null); }} />
                  {t('performance.custom.noVideo')}
                </label>}
              </div>
              {otherVideos.length > 0 && <details className="mt-2 text-xs text-text-secondary">
                <summary className="cursor-pointer">{t('performance.custom.otherVideos', { count: otherVideos.length })}</summary>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-border">{otherVideos.map((path) => choice(path, 'video'))}</div>
              </details>}
              {videoPath === undefined && <p className="mt-2 text-xs text-text-secondary">{videoOnly ? t('performance.custom.chooseVideoOnly') : t('performance.custom.chooseVideo')}</p>}
            </fieldset>}
            {(!!configPath || videoOnly) && <FormField label={t('performance.custom.name')}>
              <Input value={displayName} onChange={(event) => { setName(event.target.value); setError(null); }} maxLength={100} required disabled={!!busy} />
            </FormField>}
            {inspection.addons.length > 0 && <p className="text-xs text-text-secondary">{t('performance.custom.addonsAvailable', { count: inspection.addons.length })}</p>}
            <details className="text-xs text-text-secondary">
              <summary className="cursor-pointer">{t('performance.custom.importDetails')}</summary>
              <p className="mt-2">{t('performance.custom.compatibility')}</p>
              {inspection.unsupportedPaths.length > 0 && <p className="mt-2">{t('performance.custom.unsupportedFiles')}</p>}
            </details>
          </>}
          {error !== null && <PerformancePresetError error={error} />}
        </>}
      </form>
    </ModalBody>
    <ModalFooter>
      <Button type="button" variant="secondary" disabled={!!busy} onClick={onBack}>{t('common.actions.cancel')}</Button>
      {(!inspection || hasFiles) && <Button type="submit" form={formId} isLoading={!!busy} disabled={inspection ? !canImport : !repository.trim()}>
        {inspection ? t('performance.custom.import') : t('performance.custom.inspect')}
      </Button>}
    </ModalFooter>
  </>;
}
