import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { requirementKey, type RequirementMod } from '../../lib/modRequirements';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useAppStore } from '../../stores/appStore';
import { Tag } from '../common/ui';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { requirementWarningAssessment } from '../../lib/requirementWarningCache';

export function RequirementWarning({ mod, variant = 'inline' }: { mod: RequirementMod; variant?: 'overlay' | 'inline' }) {
  const { t } = useTranslation();
  const snapshots = useRequirementsStore(s => s.snapshots);
  const mods = useAppStore(s => s.mods);
  const files = useRequirementOrderStore(s => s.files);
  const assessment = requirementWarningAssessment(mod, mods, snapshots, files);
  if (!assessment) return null;
  const { source, label, warning } = assessment;
  const text = label === 'missing' ? t('requirements.missing') : label === 'disabled' ? t('requirements.disabled')
    : label === 'orderWarning' ? t('requirements.orderWarning') : label === 'review' ? t('requirements.review') : t('requirements.title');
  return <button type="button" data-card-action="true" className="cursor-pointer text-left rounded-sm focus-visible:outline-2 focus-visible:outline-accent" onClick={event => {
    event.stopPropagation();
    const snapshot = useRequirementsStore.getState().snapshots[requirementKey(source)];
    if (snapshot?.status === 'loaded') useRequirementsStore.getState().inspect({ ...source, name: mod.name, requirements: snapshot });
  }}><Tag icon={Link2} tone={warning ? 'warning' : 'neutral'} variant={variant}>{text}</Tag></button>;
}
