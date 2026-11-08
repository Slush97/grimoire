import { useTranslation } from 'react-i18next';

export default function PerformancePresetError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const detail = (error instanceof Error ? error.message : String(error))
    .replace(/^(?:Error: )?Error invoking remote method '[^']+': (?:Error: )?/, '');
  let message = t('performance.custom.errors.generic');
  if (/GitHub request failed \(404\)/.test(detail)) message = t('performance.custom.errors.notFound');
  else if (/GitHub request failed \((?:403|429)\)/.test(detail)) message = t('performance.custom.errors.rateLimited');
  else if (/Use a GitHub repository/.test(detail)) message = t('performance.custom.errors.repository');
  else if (/timed? ?out|timeout|aborted/i.test(detail)) message = t('performance.custom.errors.timeout');
  else if (/fetch failed|Failed to fetch|Offline|network/i.test(detail)) message = t('performance.custom.errors.offline');
  else if (/limit 50/.test(detail)) message = t('performance.custom.errors.limit');
  return <div className="space-y-2">
    <p role="alert" className="text-sm text-state-danger">{message}</p>
    <details className="text-xs text-text-secondary">
      <summary className="cursor-pointer">{t('performance.custom.errorDetails')}</summary>
      <p className="mt-2 break-words">{detail}</p>
    </details>
  </div>;
}
