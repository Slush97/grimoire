import { useEffect, useState } from 'react';
import { FlaskConical, FolderOpen, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, ModalHeader } from '../common/ui';
import { Modal } from '../common/Modal';
import { FormField, Select } from '../common/forms';
import type { BenchmarkRequirement, BenchmarkResolution, BenchmarkStatus } from '../../types/benchmark';
import BenchmarkResults from './BenchmarkResults';

const requirementKeys: Record<BenchmarkRequirement, string> = {
  platform: 'benchmark.requirements.platform', game: 'benchmark.requirements.game',
  build: 'benchmark.requirements.build',
  python: 'benchmark.requirements.python', rsync: 'benchmark.requirements.rsync',
  modlock: 'benchmark.requirements.modlock', host: 'benchmark.requirements.host',
  proton: 'benchmark.requirements.proton', steam: 'benchmark.requirements.steam',
  resources: 'benchmark.requirements.resources',
};
const phaseKeys = {
  idle: 'benchmark.phase.idle', preparing: 'benchmark.phase.preparing',
  starting_server: 'benchmark.phase.startingServer', starting_client: 'benchmark.phase.startingClient',
  warmup: 'benchmark.phase.warmup', running: 'benchmark.phase.running',
  completed: 'benchmark.phase.completed', failed: 'benchmark.phase.failed', stopped: 'benchmark.phase.stopped',
};

export default function BenchmarkLaunch({ collapsed, gameRunning }: { collapsed: boolean; gameRunning: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [status, setStatus] = useState<BenchmarkStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [resolution, setResolution] = useState<BenchmarkResolution>('game');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let wasActive = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await window.electronAPI.getBenchmarkStatus();
        if (alive) {
          setStatus(next);
          if (wasActive && !next.active) { setOpen(false); setResultsOpen(true); }
          wasActive = next.active;
        }
      } catch (e) { if (alive) setError(String(e)); }
      if (alive) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const act = async (stop: boolean) => {
    setPending(true);
    setError(null);
    try { setStatus(await (stop ? window.electronAPI.stopBenchmark() : window.electronAPI.launchBenchmark(resolution))); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); }
  };
  return <>
    {collapsed
      ? <IconButton icon={FlaskConical} label={t('benchmark.launch')} onClick={() => setOpen(true)} />
      : <Button variant="secondary" icon={FlaskConical} className="w-full" onClick={() => setOpen(true)}>{t('benchmark.launch')}</Button>}
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="benchmark-title">
      <ModalHeader title={t('benchmark.title')} titleId="benchmark-title" onClose={() => setOpen(false)} />
      <div className="space-y-4 p-4">
        <p className="text-sm text-text-secondary">{t('benchmark.description')}</p>
        <p className="text-xs text-text-tertiary">{t('benchmark.experimental')}</p>
        <FormField label={t('benchmark.resolution')} hint={t('benchmark.resolutionHint')}>
          <Select aria-label={t('benchmark.resolution')} value={resolution} disabled={pending || status?.active}
            onChange={event => setResolution(event.target.value as BenchmarkResolution)}>
            <option value="game">{t('benchmark.resolutionGame')}</option>
            <option value="1280x720">{t('benchmark.resolution720')}</option>
            <option value="1920x1080">{t('benchmark.resolution1080')}</option>
            <option value="2560x1440">{t('benchmark.resolution1440')}</option>
          </Select>
        </FormField>
        <p role="status" aria-live="polite" className="text-sm text-text-primary">
          {status ? t(phaseKeys[status.phase], { current: status.repetition, total: status.repetitions }) : t('benchmark.checking')}
        </p>
        {!!status?.missing.length && <div className="space-y-2 text-sm text-text-secondary">
          <p>{t('benchmark.missing')}</p>
          <ul className="list-disc pl-4">{status.missing.map(reason => <li key={reason}>{t(requirementKeys[reason])}</li>)}</ul>
        </div>}
        {gameRunning && !status?.active && <p className="text-sm text-text-secondary">{t('benchmark.closeGame')}</p>}
        {(error || status?.error) && <p role="alert" className="break-words text-sm text-state-danger">{error || status?.error}</p>}
        <div className="flex flex-wrap gap-2">
          {status?.active
            ? <Button variant="secondary" icon={Square} isLoading={pending} onClick={() => { void act(true); }}>{t('benchmark.stop')}</Button>
            : <Button icon={FlaskConical} isLoading={pending} disabled={!status || !!status.missing.length || gameRunning} onClick={() => { void act(false); }}>{t('benchmark.run')}</Button>}
          <Button variant="ghost" icon={FolderOpen} disabled={!status?.logs} onClick={() => { void window.electronAPI.openBenchmarkLogs().catch(e => setError(String(e))); }}>{t('benchmark.logs')}</Button>
          <Button variant="secondary" disabled={!status || status.active || pending} onClick={() => { setOpen(false); setResultsOpen(true); }}>{t('benchmark.results.open')}</Button>
        </div>
      </div>
    </Modal>
    <BenchmarkResults open={resultsOpen} onClose={() => setResultsOpen(false)} />
  </>;
}
