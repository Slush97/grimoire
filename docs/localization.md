# Localization (i18n)

Grimoire's UI is translated by the community through [Weblate](https://weblate.org).
This doc covers all three audiences: the maintainer setting Weblate up once,
developers adding translatable strings, and translators doing the work.

## How it fits together

```
src/locales/en/translation.json   <- English source of truth (devs edit this, in PRs)
        |                              i18next loads it; t('key') renders it
        v
   Hosted Weblate (hosted.weblate.org)   <- translators work here, in a web UI
        |                                    writes src/locales/<lang>/translation.json
        v
   Pull request to Slush97/grimoire   <- you review + merge; the new catalog
                                         is bundled automatically (no code change)
```

- **Library:** `i18next` + `react-i18next`. Init lives in `src/i18n.ts`.
- **Catalogs:** `src/locales/<lang>/translation.json`, one file per language,
  i18next JSON v4 format (plural suffixes `_one`/`_other`, `{{var}}` interpolation).
- **Bundling:** `src/i18n.ts` globs `src/locales/*/translation.json` eagerly, so a
  new language file is picked up at build time with zero code changes. The Settings
  language picker also reads the available set from there and only appears once a
  second language exists.
- **Detection:** the OS locale (`navigator.language`) is used by default; the user
  can override it in Settings, persisted in `AppSettings.language`.

---

## For the maintainer: one-time Hosted Weblate Libre setup

Grimoire is MIT-licensed, so it qualifies for free Libre hosting.

### 1. Apply for Libre hosting

1. Register at <https://hosted.weblate.org/>.
2. Go to <https://hosted.weblate.org/create/billing/> and choose the **Libre** plan
   (free for libre/open-source projects).
3. Fill in the project: name `Grimoire`, website `https://grimoiremods.com`, source
   code repository `https://github.com/Slush97/grimoire`, license `MIT`.
4. Submit. **A human reviews it; approval typically takes a few days.** Submit this
   first, then the rest can wait on approval.

### 2. Add the component (after approval)

Create a component in the Grimoire project with these exact settings:

| Field | Value |
|---|---|
| Version control system | Git (or "GitHub pull request", see step 3) |
| Source code repository | `https://github.com/Slush97/grimoire.git` |
| Repository branch | `main` |
| File format | **i18next JSON v4** |
| File mask | `src/locales/*/translation.json` |
| Monolingual base language file | `src/locales/en/translation.json` |
| Template for new translations | `src/locales/en/translation.json` |
| Edit base file | **off** (English is edited by devs in PRs, not in Weblate) |
| Language code style | **BCP 47** (hyphen, so it creates `pt-BR`, not `pt_BR`) |

The BCP 47 setting matters: i18next and `src/i18n.ts` expect hyphenated codes
(`pt-BR`, `zh-Hans`). The underscore style would create folders i18next won't match.

### 3. Connect GitHub so translations come back as PRs

Two options. **Option A** is the simplest and reliable; B is fully automatic.

**Option A: deploy key + push branch (recommended to start)**
1. Copy Weblate's SSH public key from your hosted.weblate.org account
   (Settings -> SSH keys -> the instance key).
2. On GitHub: repo -> Settings -> Deploy keys -> Add, paste it, **check "Allow write access"**.
3. In the component: set the repository push URL to `git@github.com:Slush97/grimoire.git`
   and the **push branch** to `weblate` (not `main`).
4. Weblate commits translations and pushes to the `weblate` branch; you open a PR
   `weblate -> main` and merge after a glance. Enable "Push on commit" or push
   manually from the component menu.

**Option B: GitHub pull requests (fully automatic)**
Set the VCS to **GitHub pull request** and authorize Hosted Weblate's GitHub app.
Weblate then opens and updates a PR itself. Use this once you're comfortable.

### 4. Recommended addons (component -> Addons)

- **Cleanup translation files** — keeps each language file structurally in sync with
  the English base and drops obsolete keys. Strongly recommended.
- **Customize JSON output** — set indentation to **2 spaces** to match the repo style
  and minimize PR diff noise.
- **Squash Git commits** — one tidy commit per push instead of one per string.

### 5. Invite translators

Point volunteers at the Grimoire project URL and the "For translators" section below.
Coordinate in the `#translations` Discord channel (invite `KgYGHEMq2P`).

---

## For developers: adding or changing UI strings

- **Never hardcode user-facing English.** Use `const { t } = useTranslation();` and
  `t('namespace.key')`. For strings built in handlers/effects, `t` is in scope from
  the same hook.
- **Only ever edit `src/locales/en/translation.json`.** Every other language file is
  owned by Weblate; hand-editing them causes merge conflicts. Adding a new English
  string means adding one key here.
- **Namespacing:** group by surface, e.g. `nav.*`, `sidebar.*`, `settings.*`,
  `common.*` (shared buttons like Cancel/Save). Keep keys descriptive, not the
  English text itself (`settings.updates.checkButton`, not `settings.checkForUpdates`).
- **Plurals:** define `key_one` and `key_other` in English and call
  `t('key', { count })`. i18next selects the form; Weblate shows each language its
  correct CLDR plural forms.
- **Interpolation:** use `{{name}}` placeholders, pass `t('key', { name })`. Do not
  build sentences by concatenating fragments; make each sentence one key.
- **New language:** zero code. A `src/locales/de/translation.json` from Weblate is
  globbed in automatically and appears in the picker.
- **Before committing:** run `pnpm i18n:check`. It fails if any `t('...')` key is
  missing from the English catalog and lists catalog keys nothing references.

---

## For translators

Thank you. A few conventions keep translations working correctly:

- **Keep `{{placeholders}}` exactly as written.** `{{count}}`, `{{names}}`, etc. are
  filled in by the app at runtime. Translate the words around them; never translate or
  alter the text inside `{{ }}`.
- **Do not translate brand and proper names:** Grimoire, Deadlock, GameBanana, Steam,
  Discord, gameinfo.gi, VPK.
- **Punctuate naturally for your language.** Grimoire's English copy avoids em-dashes,
  but that is an English-source rule only. Use whatever punctuation is correct in your
  language.
- **Plurals:** Weblate shows you the right number of plural forms for your language
  (some have one, some have several). Fill in each form it asks for.
- **Leave a string untranslated** if you're unsure; English is the fallback, so a blank
  string is better than a wrong guess.
