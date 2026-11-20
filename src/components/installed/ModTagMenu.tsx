import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, Vault } from 'lucide-react';
import type { Mod } from '../../types/mod';
import { useAppStore } from '../../stores/appStore';
import { useCategoryStore } from '../../stores/categoryStore';
import { getInstallationScope } from '../../lib/appSettings';
import { EMPTY_CUSTOM_TAGS, EMPTY_TAG_ORDER, customTagMemberKey, customTagsForMods, useInstalledTagsStore } from '../../stores/installedTagsStore';
import { getInstalledDefaultTaxonomy, getInstalledGroupTaxonomy, installedBaseTagOptions, sortInstalledTags } from '../../lib/installedCardTaxonomy';
import { HERO_NAMES_SORTED } from '../../lib/lockerUtils';
import { baseTagHasDetectedProp } from '../../lib/categoryPaths';
import { gameBananaCategoryLabel } from '../../lib/gameBananaCategories';
import { MenuItem, MenuLabel, MenuSeparator, MenuCheckboxItem } from '../common/menu';
import { HeroTagLabel } from './chips';
import { showToast } from '../../stores/toastStore';

type TagInput = Parameters<typeof getInstalledGroupTaxonomy>[0] & Pick<Mod, 'id' | 'gameBananaId' | 'sha256' | 'localGroupId'>;
export function ModTagMenuItems({ mod, variants, bulk = false, disabled = false, onApply, onBusyChange }: {
  onBusyChange?: (busy: boolean) => void;
  mod: TagInput; variants: readonly TagInput[]; bulk?: boolean; disabled?: boolean;
  onApply: (tags: Mod['tagOverrides'] | null, clearCustom?: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const detectedProps = new Set([mod, ...variants].flatMap(item => item.propTypes ?? []));
  const settings = useAppStore(state => state.settings);
  const tagScope = getInstallationScope(settings);
  const heroNames = useCategoryStore(state => state.heroNames);
  const heroByCategoryId = useCategoryStore(state => state.heroByCategoryId);
  const pathsByModel = useCategoryStore(state => state.pathsByModel);
  const taxonomyContext = { heroNames, heroByCategoryId, pathsByModel };
  const customTags = useInstalledTagsStore(state => tagScope ? state.byScope[tagScope] ?? EMPTY_CUSTOM_TAGS : EMPTY_CUSTOM_TAGS);
  const tagOrder = useInstalledTagsStore(state => tagScope ? state.orderByScope[tagScope] ?? EMPTY_TAG_ORDER : EMPTY_TAG_ORDER);
  const assignedCustomTags = customTagsForMods(customTags, variants);
  const baseTaxonomy = getInstalledGroupTaxonomy(mod, variants, taxonomyContext);
  const tagHeroNames = heroNames.length ? heroNames : HERO_NAMES_SORTED;
  const [busy, setLocalBusy] = useState(false);
  const setBusy = (value: boolean) => { setLocalBusy(value); onBusyChange?.(value); };
  const menuBusy = busy || disabled;
  const applyTags = async (tags: Mod['tagOverrides'] | null, clearCustom = false) => {
    if (menuBusy) return;
    setBusy(true);
    try { await onApply(tags, clearCustom); }
    catch (error) { showToast(String(error), { tone: 'error' }); }
    finally { setBusy(false); }
  };
  const memberships = variants.map(item => getInstalledGroupTaxonomy(item, [item], taxonomyContext));
  const mixed = (values: boolean[]): boolean | 'indeterminate' => values.every(Boolean) ? true : values.some(Boolean) ? 'indeterminate' : false;
  const state = (axis: 'base' | 'heroes', label: string) => bulk
    ? mixed(memberships.map(item => (axis === 'base' ? item.tags : item.heroNames).includes(label)))
    : (axis === 'base' ? baseTaxonomy.tags : baseTaxonomy.heroNames).includes(label);
  const customState = (id: string) => bulk
    ? mixed(variants.map(item => customTags.find(tag => tag.id === id)?.keys.includes(customTagMemberKey(item)) ?? false))
    : assignedCustomTags.some(tag => tag.id === id);
  const toggleCustom = (id: string) => {
    if (menuBusy) return;
    if (tagScope) useInstalledTagsStore.getState().setForMods(tagScope, id, variants, customState(id) !== true);
  };
  const toggleAxis = async (axis: 'base' | 'heroes', label: string, checked: boolean) => {
    if (!bulk) return applyTags({ [axis]: checked
      ? [...(axis === 'base' ? baseTaxonomy.tags : baseTaxonomy.heroNames), label]
      : (axis === 'base' ? baseTaxonomy.tags : baseTaxonomy.heroNames).filter(value => value !== label) });
    if (menuBusy) return;
    setBusy(true);
    try {
      for (const [index, item] of variants.entries()) {
        const previous = axis === 'base' ? memberships[index].tags : memberships[index].heroNames;
        await useAppStore.getState().setModTags(item.id, { [axis]: checked ? [...new Set([...previous, label])] : previous.filter(value => value !== label) });
      }
    } catch (error) { showToast(String(error), { tone: 'error' }); }
    finally { setBusy(false); }
  };
  const defaults = getInstalledDefaultTaxonomy(mod, variants, taxonomyContext);
  const heroOptions = [...new Set([...tagHeroNames, ...defaults.heroNames, ...baseTaxonomy.heroNames])].sort((a, b) => a.localeCompare(b));
  const baseOptions = sortInstalledTags(installedBaseTagOptions(taxonomyContext, [...defaults.tags, ...baseTaxonomy.tags])
    .map(label => ({ key: `tag:${label.toLowerCase()}`, label })), tagOrder);
  return <>
    <div className="grid grid-cols-2 gap-1">
      <MenuItem align="center" disabled={menuBusy} onSelect={event => { if (bulk) event.preventDefault(); void applyTags({ base: [], heroes: [] }, true); }}>{t('common.actions.clear')}</MenuItem>
      <MenuItem align="center" disabled={menuBusy} onSelect={event => { if (bulk) event.preventDefault(); void applyTags(null); }}>{t('common.actions.reset')}</MenuItem>
    </div>
    <MenuSeparator />
    {customTags.length > 0 && <>
      <MenuLabel>{t('installed.tag.custom')}</MenuLabel>
      {customTags.map(tag => <MenuCheckboxItem key={tag.id} indicatorPlacement="end" disabled={menuBusy}
        checked={customState(tag.id)}
        onCheckedChange={() => {
          if (!tagScope) return;
          toggleCustom(tag.id);
        }}>{tag.name}</MenuCheckboxItem>)}
      <MenuSeparator />
    </>}
    <MenuLabel>{t('installed.tag.base')}</MenuLabel>
    {baseOptions.map(({ key, label }) => <MenuCheckboxItem key={key} indicatorPlacement="end" disabled={menuBusy}
      checked={state('base', label)}
      endAdornment={<>
        {!bulk && baseTagHasDetectedProp(label, detectedProps) && <span className="shrink-0" title={t('installed.tag.detectedInGeneral')}><Vault aria-hidden className="h-3.5 w-3.5" /></span>}
        {!bulk && defaults.tags.includes(label) && <span className="shrink-0" title={t('installed.tag.defaultTag')}><Pin aria-hidden className="h-3.5 w-3.5" /></span>}
      </>}
      onCheckedChange={checked => void toggleAxis('base', label, checked)}>
      {gameBananaCategoryLabel(label, t)}
    </MenuCheckboxItem>)}
    <MenuSeparator />
    <MenuLabel>{t('installed.tag.hero')}</MenuLabel>
    {heroOptions.map(heroName => <MenuCheckboxItem key={heroName} indicatorPlacement="end" disabled={menuBusy}
      endAdornment={!bulk && defaults.heroNames.includes(heroName) && <span className="shrink-0" title={t('installed.tag.defaultTag')}><Pin aria-hidden className="h-3.5 w-3.5" /></span>}
      checked={state('heroes', heroName)} onCheckedChange={checked => void toggleAxis('heroes', heroName, checked)}><HeroTagLabel heroName={heroName} /></MenuCheckboxItem>)}
  </>;

}
