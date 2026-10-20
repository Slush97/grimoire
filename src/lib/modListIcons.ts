export const MOD_LIST_ICONS = ['list', 'shirt', 'music', 'flask', 'swords', 'eye', 'wrench', 'package', 'heart', 'star', 'shield', 'palette'] as const;
export type ModListIcon = typeof MOD_LIST_ICONS[number];

export function isModListIcon(value: unknown): value is ModListIcon {
  return MOD_LIST_ICONS.some((icon) => icon === value);
}
