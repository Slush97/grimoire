import { useTranslation } from 'react-i18next';
import type { GlobalModType } from '../../types/mod';
import { GLOBAL_MOD_TYPE_ORDER, globalModTypeLabel } from '../../lib/lockerUtils';
import { HeroSelect } from '../common/HeroSelect';

interface UnassignedModTagSelectProps {
  name: string;
  heroes: readonly { name: string }[];
  onTagHero: (hero: string) => Promise<void>;
  onTagGeneral: (type: GlobalModType) => Promise<void>;
}

export function UnassignedModTagSelect({ name, heroes, onTagHero, onTagGeneral }: UnassignedModTagSelectProps) {
  const { t } = useTranslation();
  return (
    <HeroSelect
      ariaLabel={t('locker.page.tagAsHeroNamed', { name })}
      value=""
      size="sm"
      onChange={(value) => {
        const type = GLOBAL_MOD_TYPE_ORDER.find((candidate) => value === `general:${candidate}`);
        if (type) void onTagGeneral(type);
        else {
          const hero = heroes.find((candidate) => value === `hero:${candidate.name}`);
          if (hero) void onTagHero(hero.name);
        }
      }}
      options={[
        { value: '', label: t('locker.page.tagAsHero'), muted: true },
        ...GLOBAL_MOD_TYPE_ORDER.map((type) => ({
          value: `general:${type}`,
          label: t('locker.page.generalCategory', { category: globalModTypeLabel(type, t) }),
        })),
        ...heroes.map((hero) => ({ value: `hero:${hero.name}`, label: hero.name, heroName: hero.name })),
      ]}
    />
  );
}
