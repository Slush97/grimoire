export const SILVER_TRANSFORMED_MODEL = 'models/heroes_wip/werewolf/transform/werewolf_transform.vmdl_c';
export const SILVER_TRANSFORMED_PREVIEW = 'Silver (transformed)';

export interface SkinModelForm {
  id: string;
  labelKey: string;
  previewHero: string;
  entry: string;
  meshGroup?: string;
  materialGroup?: string;
  materialOverride?: string;
}

// Authored player states only. Target curses, summons and projectiles have a different owner.
const HERO_FORMS: Readonly<Record<string, readonly Omit<SkinModelForm, 'previewHero'>[]>> = {
  Silver: [{ id: 'transformed', labelKey: 'foundry.skin.forms.werewolf', entry: SILVER_TRANSFORMED_MODEL }],
  Calico: [{ id: 'cat', labelKey: 'foundry.skin.forms.cat', entry: 'models/abilities/nano_catform_model.vmdl_c' }],
  Viscous: [
    { id: 'ball', labelKey: 'foundry.skin.forms.ball', entry: 'models/heroes_staging/viscous/viscous.vmdl_c', meshGroup: 'inflated' },
    { id: 'cube', labelKey: 'foundry.skin.forms.cube', entry: 'models/abilities/viscous_cube.vmdl_c' },
  ],
  Ivy: [{ id: 'stone', labelKey: 'foundry.skin.forms.stone', entry: 'models/particle/tengu_stone_form_model_fx.vmdl_c',
    materialOverride: 'materials/particle/abilities/tengu/tengu_stone_form_model.vmat' }],
};

export function skinModelForms(heroName: string, entry: string): SkinModelForm[] {
  return [{ id: 'default', labelKey: 'foundry.skin.defaultForm', previewHero: heroName, entry },
    ...(HERO_FORMS[heroName] ?? []).map((form) => ({ ...form,
      previewHero: heroName === 'Silver' ? SILVER_TRANSFORMED_PREVIEW : `${heroName} (${form.id})`,
    }))];
}

export function skinPreviewForm(previewHero: string): SkinModelForm | undefined {
  return Object.keys(HERO_FORMS).flatMap((hero) => skinModelForms(hero, '').slice(1))
    .find((form) => form.previewHero === previewHero);
}

export function skinFormExportArgs(form: SkinModelForm | undefined): string[] {
  return form ? [...(form.meshGroup ? ['--mesh-group', form.meshGroup] : []),
    ...(form.materialGroup ? ['--material-group', form.materialGroup] : []),
    ...(form.materialOverride ? ['--material-override', form.materialOverride] : [])] : [];
}
