import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Expand, Shrink } from 'lucide-react';
import { IconButton } from '../common/ui';

function subscribe(onChange: () => void) {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}
const snapshot = () => !!document.fullscreenElement;
const serverSnapshot = () => false;

export function ViewerFullscreenButton({ onRequest }: { onRequest: () => void }) {
  const { t } = useTranslation();
  const fullscreen = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <IconButton size="sm" icon={fullscreen ? Shrink : Expand}
    label={fullscreen ? t('locker.pose.exitFullscreen') : t('locker.pose.fullscreen')}
    aria-pressed={fullscreen} onClick={onRequest} />;
}
