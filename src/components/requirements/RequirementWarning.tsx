import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { hasRequirementIssues, modRequirementRefs, requirementKey, matchRequirement, type RequirementMod } from '../../lib/modRequirements';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useAppStore } from '../../stores/appStore';
import { Tag } from '../common/ui';

export function RequirementWarning({ mod, variant = 'inline' }: { mod: RequirementMod; variant?: 'overlay' | 'inline' }) {
  const { t } = useTranslation();
  const snapshots = useRequirementsStore(s => s.snapshots);
  const mods = useAppStore(s => s.mods);
  const source = modRequirementRefs(mod).find(target => hasRequirementIssues(snapshots[requirementKey(target)], mods));
  if (!source) return null;
  const snapshot = snapshots[requirementKey(source)];
  const label = snapshot.status === 'unavailable' ? t('requirements.unchecked')
    : snapshot.items.some(item => matchRequirement(item, mods).state === 'missing') ? t('requirements.missing')
    : snapshot.items.some(item => matchRequirement(item, mods).state === 'disabled') ? t('requirements.disabled') : t('requirements.review');
  return <button type="button" data-card-action="true" className="cursor-pointer text-left rounded-sm focus-visible:outline-2 focus-visible:outline-accent" onClick={event => {
    event.stopPropagation();
    useRequirementsStore.getState().inspect({ ...source, name: mod.name, requirements: snapshot });
  }}><Tag icon={Link2} tone={snapshot.status === 'unavailable' ? 'neutral' : 'warning'} variant={variant}>{label}</Tag></button>;
}
