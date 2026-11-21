import { isLocalMod, localVariantOriginIneligibility } from '../../../src/lib/localVariantEligibility';
import type { LocalVariantGroupTarget } from '../../../src/types/electron';
import type { GlobalModType, LockerHeroSource } from '../../../src/types/mod';

/**
 * The pure half of local variant grouping (see the `set-local-variant-group`
 * handler in ipc/mods.ts). Given every installed mod's grouping-relevant
 * fields, which sidecars have to change so the listed mods end up in (or out
 * of) one local variant group?
 *
 * Kept pure and free of fs/electron so the rules that are easy to get wrong
 * (origin preservation, name unification, orphan pruning) are unit
 * tested instead of only reachable through a real install.
 */

/** One installed mod, reduced to what grouping cares about. */
export interface LocalVariantGroupMember {
    id: string;
    /** Sidecar key: what a write is addressed to. */
    metaKey: string;
    /** Current display name (metadata.modName, or the scan's fallback). */
    name: string;
    /** Embedded or associated GameBanana identity, independent of file origin. */
    gameBananaId?: number;
    sourceSection?: string;
    localGroupId?: string;
    localImport?: boolean;
    lockerHero?: string;
    lockerHeroSource?: LockerHeroSource;
    globalType?: GlobalModType | null;
    globalTypeSource?: 'manual';
    /** Runtime comparison only. Never propagated to another VPK's metadata. */
    resolvedHeroes?: readonly string[];
    resolvedGlobalType?: GlobalModType;
    priorityMod?: boolean;
    merged?: boolean;
}

/** Group-wide placement only; classification remains per file. */
export interface LocalVariantGroupProfile {
    priorityMod: boolean;
}

/** One sidecar merge-write. Fields left undefined are not touched. */
export interface LocalVariantGroupWrite {
    id: string;
    metaKey: string;
    /** undefined clears the membership: setModMetadata merge-writes and the
     *  JSON encoder drops undefined values, so the key disappears. */
    localGroupId: string | undefined;
    localImport?: boolean;
    /** Present only when this member has to adopt the group's name. */
    modName?: string;
}

export interface LocalVariantGroupPlan {
    /** The group the listed mods now belong to, or null after a clear. */
    groupId: string | null;
    writes: LocalVariantGroupWrite[];
}

function currentGroupOf(member: LocalVariantGroupMember): string | undefined {
    return member.localGroupId && member.localGroupId.length > 0 ? member.localGroupId : undefined;
}

/** Group membership never compares or propagates per-file classifications.
 * Priority-root placement still requires a filesystem move, so grouping cannot
 * silently change it through metadata alone. */
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

    return { priorityMod: priority };
}

/**
 * Plan the sidecar writes for one grouping request.
 *
 * Rules, in order:
 *  1. Every listed id must exist. Merged outputs are ineligible. Grouping
 *     preserves each member's import origin and GameBanana identity.
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
    // Existing members establish the shared priority-folder placement.
    const existingGroupMembers = groupId
        ? all.filter(
              (member) => !targetIds.has(member.id) && currentGroupOf(member) === groupId
          )
        : [];
    const groupedMembers = groupId ? [...existingGroupMembers, ...targets] : [];
    if (groupId) {
        const reason = localVariantOriginIneligibility(groupedMembers);
        if (reason === 'gamebanana') throw new Error('Cannot group different GameBanana submissions as variants');
        // Add variant seeds the parent group before importing its local files.
        // Downloaded-only selections are disabled in bulk Group, but this internal
        // setup step must remain available for variants of one submission.
    }
    if (groupId) resolveLocalVariantGroupProfile(groupedMembers);
    const remoteOwner = groupedMembers.filter(member => !isLocalMod(member))
        .sort((a, b) => a.gameBananaId! - b.gameBananaId!)[0];
    const groupName = groupId ? remoteOwner?.name ?? existingGroupMembers[0]?.name ?? targets[0].name : undefined;


    const writes: LocalVariantGroupWrite[] = [];
    for (const member of groupId ? groupedMembers : targets) {
        const groupChanged = currentGroupOf(member) !== (groupId ?? undefined);
        const nameChanged = targetIds.has(member.id) && !!groupName && member.name !== groupName;
        if (!groupChanged && !nameChanged) continue;
        writes.push({
            id: member.id,
            metaKey: member.metaKey,
            localGroupId: groupId ?? undefined,
            ...(groupId && (remoteOwner || member.localImport !== undefined) ? { localImport: isLocalMod(member) } : {}),
            modName: nameChanged ? groupName : undefined,
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
