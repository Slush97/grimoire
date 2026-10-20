import { useTranslation } from 'react-i18next';
import { browseErrorDetails, browseErrorKind } from '../../lib/browseError';

export function BrowseErrorDescription({ error }: { error: string }) {
  const { t } = useTranslation();
  const kind = browseErrorKind(error);
  const messages = {
    connection: t('browse.errors.connection'),
    timeout: t('browse.errors.timeout'),
    rateLimited: t('browse.errors.rateLimited'),
    blocked: t('browse.errors.blocked'),
    unavailable: t('browse.errors.unavailable'),
    unexpected: t('browse.errors.unexpected'),
  };

  return (
    <div className="space-y-3 text-sm text-text-secondary">
      <p>{messages[kind]}</p>
      <details className="text-xs text-text-tertiary">
        <summary className="cursor-pointer rounded-sm hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent">
          {t('browse.errors.technicalDetails')}
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words select-text">{browseErrorDetails(error)}</p>
      </details>
    </div>
  );
}
