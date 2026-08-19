import type { LocalVariantGroupTarget } from '../../../src/types/electron';
import type { GlobalModType, LockerHeroSource } from '../../../src/types/mod';

/**
 * The pure half of local variant grouping (see the `set-local-variant-group`
 * handler in ipc/mods.ts). Given every installed mod's grouping-relevant
 * fields, which sidecars have to change so the listed mods end up in (or out
 * of) one local variant group?
 *
 * Kept pure and free of fs/electron so the rules that are easy to get wrong
 * (the GameBanana rejection, name unification, orphan pruning) are unit
 * tested instead of only reachable through a real install.
 */

/** One installed mod, reduced to what grouping cares about. */
export interface LocalVariantGroupMember {
    id: string;
    /** Sidecar key: what a write is addressed to. */
    metaKey: string;
    /** Current display name (metadata.modName, or the scan's fallback). */
    name: string;
    /** Positive only for GameBanana mods, which group by submission id. */
    gameBananaId?: number;
    localGroupId?: string;
    lockerHero?: string;
    lockerHeroSource?: LockerHeroSource;
    lockerHeroVpkChecked?: boolean;
    globalType?: GlobalModType | null;
    globalTypeClassifierVersion?: number;
    priorityMod?: boolean;
    merged?: boolean;
}

export interface LocalVariantGroupClassification {
    lockerHero: string | undefined;
    lockerHeroSource: LockerHeroSource | undefined;
    lockerHeroVpkChecked: boolean | undefined;
    globalType: GlobalModType | null;
    globalTypeClassifierVersion: number | undefined;
}

export interface LocalVariantGroupProfile {
    classification?: LocalVariantGroupClassification;
    priorityMod: boolean;
}

/** One sidecar merge-write. Fields left undefined are not touched. */
export interface LocalVariantGroupWrite {
    id: string;
    metaKey: string;
    /** undefined clears the membership: setModMetadata merge-writes and the
     *  JSON encoder drops undefined values, so the key disappears. */
    localGroupId: string | undefined;
    /** Present only when this member has to adopt the group's name. */
    modName?: string;
    /** Present when an unclassified member must inherit the group's Locker axis. */
    classification?: LocalVariantGroupClassification;
}

export interface LocalVariantGroupPlan {
    /** The group the listed mods now belong to, or null after a clear. */
    groupId: string | null;
    writes: LocalVariantGroupWrite[];
}

type LocalVariantClassificationFields = Pick<
    LocalVariantGroupMember,
    'lockerHero' | 'globalType'
>;

/** A normal GameBanana install groups by submission id. An explicitly-local
 * group is different: re-import adoption may legitimately discover GB
 * provenance after its localGroupId was minted, and that must not make the
 * group impossible to edit or clear. */
function isGameBananaOnlyMod(member: LocalVariantGroupMember): boolean {
    return (
        typeof member.gameBananaId === 'number' &&
        member.gameBananaId > 0 &&
        !currentGroupOf(member)
    );
}

function currentGroupOf(member: LocalVariantGroupMember): string | undefined {
    return member.localGroupId && member.localGroupId.length > 0 ? member.localGroupId : undefined;
}

function classificationKey(member: LocalVariantClassificationFields): string | undefined {
    if (member.globalType) return `global:${member.globalType}`;
    const hero = member.lockerHero?.trim();
    return hero ? `hero:${hero.toLocaleLowerCase()}` : undefined;
}

/** Reject two definite but different Locker axes. An unclassified VPK may
 * inherit the established group profile, but a known Ivy/Geist or hero/Global
 * mismatch must not be silently relabelled merely because it arrived through
 * the import path instead of the installed-mod grouping path. */
export function assertCompatibleLocalVariantClassifications(
    established: LocalVariantClassificationFields | undefined,
    candidate: LocalVariantClassificationFields | undefined
): void {
    if (!established || !candidate) return;
    const establishedKey = classificationKey(established);
    const candidateKey = classificationKey(candidate);
    if (establishedKey && candidateKey && establishedKey !== candidateKey) {
        throw new Error('Variants must use the same Locker hero or Global classification');
    }
}

/** Resolve the fields that must be identical across one logical card.
 * Unclassified members inherit a known peer's Locker axis. Two positive but
 * different classifications are refused: silently relabelling an Ivy VPK as
 * Geist (or a HUD as a hero skin) would be worse than declining the grouping.
 * Priority-root placement is never inferred/rewritten here because it entails
 * a filesystem move; mixed placement is therefore rejected before metadata is
 * touched. */
export function resolveLocalVariantGroupProfile(
    members: readonly LocalVariantGroupMember[]
): LocalVariantGroupProfile {
    if (members.length === 0) return { priorityMod: false };

    const priority = !!members[0].priorityMod;
    const placementConflict = members.find((member) => !!member.priorityMod !== priority);
    if (placementConflict) {
        throw new Error(
            'Variants must use the same Global priority-folder setting before they can be grouped'
        );
    }

    const classified = members.filter((member) => classificationKey(member));
    const owner = classified[0];
    for (const member of classified.slice(1)) {
        assertCompatibleLocalVariantClassifications(owner, member);
    }
    if (!owner) return { priorityMod: priority };

    if (owner.globalType) {
        return {
            priorityMod: priority,
            classification: {
                globalType: owner.globalType,
                globalTypeClassifierVersion: owner.globalTypeClassifierVersion,
                lockerHero: undefined,
                lockerHeroSource: undefined,
                lockerHeroVpkChecked: undefined,
            },
        };
    }

    return {
        priorityMod: priority,
        classification: {
            globalType: null,
            globalTypeClassifierVersion: owner.globalTypeClassifierVersion,
            lockerHero: owner.lockerHero?.trim(),
            lockerHeroSource: owner.lockerHeroSource,
            lockerHeroVpkChecked: owner.lockerHeroVpkChecked,
        },
    };
}

function needsClassification(
    member: LocalVariantGroupMember,
    classification: LocalVariantGroupClassification
): boolean {
    return (
        member.lockerHero !== classification.lockerHero ||
        member.lockerHeroSource !== classification.lockerHeroSource ||
        member.lockerHeroVpkChecked !== classification.lockerHeroVpkChecked ||
        member.globalType !== classification.globalType ||
        member.globalTypeClassifierVersion !== classification.globalTypeClassifierVersion
    );
}

/**
 * Plan the sidecar writes for one grouping request.
 *
 * Rules, in order:
 *  1. Every listed id must exist. Standalone GameBanana installs and merged
 *     outputs are ineligible; a local-group member that later adopted GB
 *     provenance remains eligible so the explicit group can be edited.
 *  2. Grouping unifies `modName` across the group, because the card title is
 *     the primary's name and the primary changes as files are toggled. An
 *     existing member of the joined group owns the name; otherwise the first
 *     listed mod does. Variant labels are left alone (they are what tells the
 *     members apart).
 *  3. A group that would be left with a single member is dissolved: a
 *     one-member group renders as a plain card anyway, so keeping the id would
 *     leave invisible state behind that a later import could silently join.
 *
 * `mintGroupId` is injected so the uuid source stays the caller's (the main
 * process) and the plan stays deterministic under test.
 */
export function planLocalVariantGroup(
    all: readonly LocalVariantGroupMember[],
    modIds: readonly string[],
    target: LocalVariantGroupTarget,
    mintGroupId: () => string
): LocalVariantGroupPlan {
    const uniqueIds = Array.from(new Set(modIds));
    if (uniqueIds.length === 0) {
        throw new Error('No mods were selected');
    }

    const byId = new Map(all.map((member) => [member.id, member]));
    const targets = uniqueIds.map((id) => {
        const member = byId.get(id);
        if (!member) throw new Error(`Mod not found: ${id}`);
        return member;
    });
    const offender = targets.find(isGameBananaOnlyMod);
    if (offender) {
        throw new Error(
            `Only local mods can be grouped as variants (${offender.name} came from GameBanana)`
        );
    }
    const merged = targets.find((member) => member.merged);
    if (merged) {
        throw new Error(`Merged outputs cannot be grouped as variants (${merged.name})`);
    }

    let groupId: string | null;
    if (target.mode === 'clear') {
        groupId = null;
    } else if (target.mode === 'join') {
        const trimmed = target.groupId?.trim() ?? '';
        if (!trimmed) throw new Error('A variant group is required');
        groupId = trimmed;
    } else {
        groupId = mintGroupId();
    }

    const targetIds = new Set(targets.map((member) => member.id));
    // Rule 2: whose name the group takes.
    const groupName = groupId
        ? all.find((member) => !targetIds.has(member.id) && currentGroupOf(member) === groupId)
              ?.name ?? targets[0].name
        : undefined;
    // Existing members lead on a join: their established manual/classifier
    // provenance is the group profile. A fresh mint has no existing members,
    // so the caller's target order remains authoritative.
    const existingGroupMembers = groupId
        ? all.filter(
              (member) => !targetIds.has(member.id) && currentGroupOf(member) === groupId
          )
        : [];
    const groupedMembers = groupId ? [...existingGroupMembers, ...targets] : [];
    const groupProfile = groupId ? resolveLocalVariantGroupProfile(groupedMembers) : undefined;

    const writes: LocalVariantGroupWrite[] = [];
    for (const member of groupId ? groupedMembers : targets) {
        const groupChanged = currentGroupOf(member) !== (groupId ?? undefined);
        const nameChanged = targetIds.has(member.id) && !!groupName && member.name !== groupName;
        const classification = groupProfile?.classification;
        const classificationChanged = !!classification && needsClassification(member, classification);
        if (!groupChanged && !nameChanged && !classificationChanged) continue;
        writes.push({
            id: member.id,
            metaKey: member.metaKey,
            localGroupId: groupId ?? undefined,
            modName: nameChanged ? groupName : undefined,
            ...(classificationChanged ? { classification } : {}),
        });
    }

    // Rule 3: dissolve any group the targets just emptied down to one member.
    const vacated = new Set<string>();
    for (const member of targets) {
        const previous = currentGroupOf(member);
        if (previous && previous !== groupId) vacated.add(previous);
    }
    for (const previous of vacated) {
        const survivors = all.filter(
            (member) => !targetIds.has(member.id) && currentGroupOf(member) === previous
        );
        if (survivors.length !== 1) continue;
        writes.push({
            id: survivors[0].id,
            metaKey: survivors[0].metaKey,
            localGroupId: undefined,
        });
    }

    return { groupId, writes };
}
