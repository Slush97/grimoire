import { List, Shirt, Music, FlaskConical, Swords, Eye, Wrench, Package, Heart, Star, Shield, Palette, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MOD_LIST_ICONS, isModListIcon, type ModListIcon } from '../../lib/modListIcons';
import type { ModList } from '../../lib/modLists';
import { IconButton } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem } from '../common/menu';

const icons: Record<ModListIcon, LucideIcon> = {
  list: List, shirt: Shirt, music: Music, flask: FlaskConical, swords: Swords, eye: Eye,
  wrench: Wrench, package: Package, heart: Heart, star: Star, shield: Shield, palette: Palette,
};

export function ModListGlyph({ icon = 'list', className = 'h-4 w-4 shrink-0' }: { icon?: ModListIcon; className?: string }) {
  const Icon = icons[icon];
  return <Icon className={className} aria-hidden />;
}

export function ModListIconPicker({ list, onChange, disabled }: { list: ModList; onChange: (icon: ModListIcon) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const labels: Record<ModListIcon, string> = {
    list: t('installed.lists.icons.list'), shirt: t('installed.lists.icons.shirt'), music: t('installed.lists.icons.music'),
    flask: t('installed.lists.icons.flask'), swords: t('installed.lists.icons.swords'), eye: t('installed.lists.icons.eye'),
    wrench: t('installed.lists.icons.wrench'), package: t('installed.lists.icons.package'), heart: t('installed.lists.icons.heart'),
    star: t('installed.lists.icons.star'), shield: t('installed.lists.icons.shield'), palette: t('installed.lists.icons.palette'),
  };
  return <MenuRoot kind="dropdown">
    <MenuTrigger asChild><IconButton icon={icons[list.icon ?? 'list']} label={t('installed.lists.chooseIcon', { name: list.name })} disabled={disabled} /></MenuTrigger>
    <MenuContent onEscapeKeyDown={(event) => event.stopPropagation()} className="w-72 [&_[role=group]]:grid [&_[role=group]]:grid-cols-2">
      <MenuLabel>{t('installed.lists.icon')}</MenuLabel>
      <MenuRadioGroup value={list.icon ?? 'list'} onValueChange={(value) => { if (isModListIcon(value)) onChange(value); }}>
        {MOD_LIST_ICONS.map((icon) => <MenuRadioItem key={icon} value={icon}>
          <span className="flex items-center gap-2"><ModListGlyph icon={icon} />{labels[icon]}</span>
        </MenuRadioItem>)}
      </MenuRadioGroup>
    </MenuContent>
  </MenuRoot>;
}
