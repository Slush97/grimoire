/**
 * Skin -> icon links: the pure decision layer.
 *
 * The Deadlock icon ecosystem is built on companion mods. A global pack (e.g.
 * DEADLOCK TOASTED) restyles every hero's card, then per-skin addons restyle ONE
 * hero's card to match a specific skin. Loading both correctly by hand means
 * winning a three-way pakNN fight against the skin bundle AND the pack, which is
 * literally what those addons' install instructions ask users to do ("RENAME THE
 * TOASTED ICON MOD TO pak02_dir.vpk OR A NUMBER BIGGER").
 *
 * A link says "whenever this skin is on, apply that hero's card from that mod",
 * and the existing hero-card pipeline does the rest: the art is split into the
 * Locker-managed cosmetics VPK in citadel/grimoire, which wins by SearchPaths
 * folder precedence, so load order stops mattering entirely.
 *
 * Everything here is pure so it can be unit-tested and shared: the main process
 * (services/lockerCardLinks.ts) supplies the live enabled set and performs the
 * rebuild, the renderer uses the same key function so both sides agree on
 * identity.
 */
import type { LockerCardLink, LockerCardSelection, Mod } from '../types/mod';
import { codenamesForHero } from './heroCodenames';

/** The identity fields a stable skin key is derived from. Structural so both a
 *  renderer `Mod` and a main-process scan row can be passed directly. */
export interface LinkKeyFields {
  gameBananaId?: number;
  sha256?: string;
  id: string;
}

/**
 * Stable key for the skin half of a link.
 *
 * The fallback chain matters. `mod.id` is `md5(metaKey)` and EVERY enable,
 * disable and reorder renames the VPK (pak07 -> pak12, addons -> .disabled),
 * which changes the metaKey and therefore the id. A link keyed on id alone would
 * break on exactly the toggles it exists to survive. GameBanana id is stable and
 * group-scoped (so it matches the Locker's own skin grouping, covering
 * multi-variant submissions with one link); sha256 is stable content identity
 * for local imports; the id is a last resort for a mod with neither.
 *
 * Mirrors shuffleSkinKey (lockerRandomizer.ts) on purpose: same problem, same
 * answer, so a skin pooled for shuffle and linked to an icon agree on identity.
 */
export function lockerLinkKey(mod: LinkKeyFields): string {
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gamebanana:${mod.gameBananaId}`;
  }
  if (mod.sha256) return `sha256:${mod.sha256}`;
  return `mod:${mod.id}`;
}

/**
 * Global load-order rank from a metaKey: lower = higher priority (loads as
 * pak01, wins file conflicts). With overflow folders the pakNN repeats per
 * folder, so the folder index from `addons{N}/...` is folded in to get a single
 * monotonic order; base citadel/addons (and .disabled) is folder 0.
 *
 * Lives here rather than in lockerUtils because the main process needs the same
 * formula to rank linked skins and cannot import lockerUtils (which reaches for
 * renderer-only asset paths). lockerUtils.modLoadOrder delegates to this so
 * there is exactly one definition.
 */
export function loadOrderFromMetaKey(metaKey: string, priority: number): number {
  const match = metaKey.match(/^addons(\d+)\//);
  const folderIndex = match ? parseInt(match[1], 10) : 0;
  return folderIndex * 100 + priority;
}

/** One currently-enabled skin, as the planner sees it. */
export interface ActiveSkin {
  key: string;
  /** Global load order (lower = wins file conflicts). Breaks ties when two
   *  linked skins for the SAME hero are enabled at once. */
  loadOrder: number;
}

/** Turn a link into the card selection it implies. */
function selectionForLink(link: LockerCardLink, addedAt: string): LockerCardSelection {
  return {
    heroCodename: link.heroCodename,
    heroName: link.heroName,
    variants: link.variants,
    source: {
      kind: 'mod',
      fileName: link.sourceKey,
      modName: link.sourceModName,
      gameBananaId: link.sourceGameBananaId,
      sha256AtApplyTime: link.sourceSha256 ?? '',
    },
    origin: 'link',
    linkedSkinKey: link.skinKey,
    addedAt,
  };
}

/**
 * The card selection set implied by `links` given which skins are enabled.
 *
 * Rules, in order:
 *  1. Every non-link selection (manual pick, custom upload, legacy entry with no
 *     `origin`) is kept verbatim. Reconcile never touches a card the user chose
 *     by hand.
 *  2. A hero that already has a non-link selection is skipped entirely, so a
 *     manual pick can't be clobbered by a link. In practice this is unreachable
 *     because linking and manual-applying each clear the other side, but the
 *     planner enforces the invariant rather than trusting it.
 *  3. Otherwise each link whose skin is currently enabled contributes its
 *     hero's card. Two enabled linked skins for the same hero resolve by load
 *     order: the skin that wins in-game is the one whose icons apply.
 *  4. Link selections whose skin is no longer enabled simply aren't re-added,
 *     which is how disabling a skin reverts its icons.
 */
export function planLinkedCards(input: {
  links: readonly LockerCardLink[];
  current: readonly LockerCardSelection[];
  activeSkins: readonly ActiveSkin[];
  /** Timestamp for newly added selections. Injected so the result is
   *  deterministic under test (and because Date.now is unavailable in some
   *  execution contexts). */
  now: string;
}): LockerCardSelection[] {
  const { links, current, activeSkins, now } = input;

  const orderByKey = new Map<string, number>();
  for (const skin of activeSkins) {
    const prior = orderByKey.get(skin.key);
    if (prior === undefined || skin.loadOrder < prior) orderByKey.set(skin.key, skin.loadOrder);
  }

  // Rule 1 + 2: manual/custom entries survive and claim their hero.
  const next = current.filter((sel) => sel.origin !== 'link');
  const ownedHeroes = new Set(next.map((sel) => sel.heroCodename));

  // Rule 3: best live link per hero.
  const bestByHero = new Map<string, { link: LockerCardLink; loadOrder: number }>();
  for (const link of links) {
    const loadOrder = orderByKey.get(link.skinKey);
    if (loadOrder === undefined) continue; // rule 4: skin not enabled
    if (ownedHeroes.has(link.heroCodename)) continue;
    const best = bestByHero.get(link.heroCodename);
    if (!best || loadOrder < best.loadOrder) bestByHero.set(link.heroCodename, { link, loadOrder });
  }

  for (const { link } of bestByHero.values()) {
    // Carry the previous addedAt when this exact link was already applied, so an
    // unrelated toggle doesn't churn the timestamp (and with it the signature).
    const prior = current.find(
      (sel) =>
        sel.origin === 'link' &&
        sel.heroCodename === link.heroCodename &&
        sel.linkedSkinKey === link.skinKey &&
        sel.source.fileName === link.sourceKey
    );
    next.push(selectionForLink(link, prior?.addedAt ?? now));
  }

  return next;
}

/**
 * Order-independent fingerprint of a selection set, used to skip the (expensive,
 * vpkmerge-shelling) rebuild when a toggle changed nothing relevant. Covers
 * everything that affects the built VPK plus the owner, so a manual -> link
 * handover of the same source still counts as a change.
 */
export function selectionsSignature(selections: readonly LockerCardSelection[]): string {
  return selections
    .map(
      (sel) =>
        `${sel.heroCodename}|${sel.origin ?? 'manual'}|${sel.source.kind ?? 'mod'}|${
          sel.source.fileName
        }|${sel.linkedSkinKey ?? ''}`
    )
    .sort()
    .join('\n');
}

/** Links minus every entry for `heroCodename`. Used to enforce the one-owner-
 *  per-hero invariant when a manual pick or revert takes the hero over. */
export function withoutHero(
  links: readonly LockerCardLink[],
  heroCodename: string
): LockerCardLink[] {
  return links.filter((link) => link.heroCodename !== heroCodename);
}

/** Links minus the binding for `skinKey` (unlinking one skin). */
export function withoutSkin(links: readonly LockerCardLink[], skinKey: string): LockerCardLink[] {
  return links.filter((link) => link.skinKey !== skinKey);
}

/**
 * Upsert `link`, replacing any prior binding for the same skin AND any other
 * binding for the same hero. Both are required by the one-owner invariant: a
 * skin links to at most one icon mod, and a hero's card has at most one source.
 */
export function upsertLink(
  links: readonly LockerCardLink[],
  link: LockerCardLink
): LockerCardLink[] {
  const kept = links.filter(
    (existing) => existing.skinKey !== link.skinKey && existing.heroCodename !== link.heroCodename
  );
  return [...kept, link];
}

/**
 * Companion icon mods installed for `heroName`: VPKs that carry nothing but this
 * hero's card art (see classifyHeroIconOnly). That is the shape of the per-skin
 * icon addons published alongside the big icon packs, and they are the only
 * things worth offering as a skin's icon source. Enabled and disabled mods both
 * qualify: the apply pipeline splits the art out of the file directly, so a
 * linked addon never needs a load-order slot of its own.
 */
export function heroIconMods(mods: Mod[], heroName: string): Mod[] {
  const codenames = new Set(codenamesForHero(heroName));
  if (codenames.size === 0) return [];
  return mods
    .filter((mod) => mod.heroIconOnly && codenames.has(mod.heroIconOnly))
    .sort((a, b) => a.name.localeCompare(b.name));
}
