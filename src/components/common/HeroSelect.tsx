import { useMemo } from 'react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';
import { DropdownSelect, type DropdownSelectOption, type DropdownSelectProps } from './forms';

export interface HeroSelectOption extends Omit<DropdownSelectOption, 'icon'> {
  heroName?: string;
}

interface HeroSelectProps extends Omit<DropdownSelectProps, 'options'> {
  options: readonly HeroSelectOption[];
}

export function HeroSelect({ options, placeholder = 'Select hero', ...props }: HeroSelectProps) {
  const heroOptions = useMemo(() => options.map(({ heroName, ...option }) => ({
    ...option,
    icon: heroName ? (
      <img
        src={getHeroChipIconPath(heroName)}
        alt=""
        aria-hidden="true"
        className="h-5 w-5 flex-shrink-0 object-contain"
        loading="lazy"
      />
    ) : undefined,
  })), [options]);

  return <DropdownSelect {...props} placeholder={placeholder} options={heroOptions} />;
}
