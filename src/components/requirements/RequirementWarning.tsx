import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import type { RequirementMod } from '../../lib/modRequirements';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useAppStore } from '../../stores/appStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { requirementWarningAssessment } from '../../lib/requirementWarningCache';

export function RequirementWarning({ mod, children }: {
  mod: RequirementMod;
  children?: (icon: ReactNode, title: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const snapshots = useRequirementsStore(s => s.snapshots);
  const mods = useAppStore(s => s.mods);
  const files = useRequirementOrderStore(s => s.files);
  const assessment = requirementWarningAssessment(mod, mods, snapshots, files);
  if (!assessment) return children ? children(null, '') : null;
  const { label, warning } = assessment;
  const text = label === 'missing' ? t('requirements.missing') : label === 'disabled' ? t('requirements.disabled')
    : label === 'orderWarning' ? t('requirements.orderWarning') : label === 'review' ? t('requirements.review') : t('requirements.title');
  const icon = <button type="button" data-card-action="true" data-requirement-warning
    title={text} aria-label={text}
    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-accent ${warning ? 'text-state-warning' : 'text-text-secondary'}`} onClick={event => {
    event.stopPropagation();
    const liveMods = useAppStore.getState().mods;
    const liveMod = liveMods.find(candidate => candidate.id === mod.id);
    if (liveMod) useRequirementsStore.getState().manage(liveMod, liveMods);
  }}><Link2 aria-hidden className="h-4 w-4" /></button>;
  return children ? children(icon, text) : icon;
}
