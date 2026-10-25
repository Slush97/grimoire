import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { hasInstalledRequirementIssues, modRequirementRefs, requirementKey, matchRequirement, skinRequirementSource, requirementSnapshot, type RequirementMod } from '../../lib/modRequirements';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useAppStore } from '../../stores/appStore';
import { Tag } from '../common/ui';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { requirementOrderIssues } from '../../lib/requirementLoadOrder';

export function RequirementWarning({ mod, variant = 'inline' }: { mod: RequirementMod; variant?: 'overlay' | 'inline' }) {
  const { t } = useTranslation();
  const snapshots = useRequirementsStore(s => s.snapshots);
  const mods = useAppStore(s => s.mods);
  const files = useRequirementOrderStore(s => s.files);
  const refs = modRequirementRefs(mod);
  const local = skinRequirementSource(mod, mods);
  const orderIssues = [...(local ? requirementOrderIssues(local, local.requirements, mods, files) : []),
    ...refs.flatMap(target => requirementOrderIssues(target, snapshots[requirementKey(target)], mods, files))].filter(issue => issue.overlay.id === mod.id);
  const source = local ?? refs.find(target => hasInstalledRequirementIssues(mod, snapshots[requirementKey(target)], mods)) ?? orderIssues[0]?.source ?? refs.find(target => {
    const snapshot = snapshots[requirementKey(target)];
    return snapshot?.status === 'loaded' && snapshot.items.some(item => item.importance === 'required');
  });
  if (!source) return null;
  const snapshot = requirementSnapshot(source, mods, snapshots);
  if (snapshot?.status !== 'loaded') return null;
  const issues = hasInstalledRequirementIssues(mod, snapshot, mods);
  const label = issues && snapshot.items.some(item => matchRequirement(item, mods).state === 'missing') ? t('requirements.missing')
    : issues && snapshot.items.some(item => matchRequirement(item, mods).state === 'disabled') ? t('requirements.disabled')
    : orderIssues.length > 0 ? t('requirements.orderWarning')
    : issues ? t('requirements.review') : t('requirements.title');
  return <button type="button" data-card-action="true" className="cursor-pointer text-left rounded-sm focus-visible:outline-2 focus-visible:outline-accent" onClick={event => {
    event.stopPropagation();
    useRequirementsStore.getState().inspect({ ...source, name: mod.name, requirements: snapshot });
  }}><Tag icon={Link2} tone={issues || orderIssues.length > 0 ? 'warning' : 'neutral'} variant={variant}>{label}</Tag></button>;
}
