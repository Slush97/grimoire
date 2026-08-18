import type { RestoreLocalVariantGroupReplacementArgs } from '../../../src/types/electron';
import type {
    LocalVariantGroupClassification,
    LocalVariantGroupMember,
} from './localVariantGroup';
import { resolveLocalVariantGroupProfile } from './localVariantGroup';

export interface LocalVariantReplacementMember extends LocalVariantGroupMember {
    gameBananaFileId?: number;
}

export interface LocalVariantReplacementPlan {
    groupId: string;
    modName: string;
    classification: LocalVariantGroupClassification;
    replacementMetaKeys: string[];
}

const positiveInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Validate the privileged update-only bridge before any sidecar is touched.
 * The still-installed source proves that the explicit group exists, while GB
 * id + destination file id bind every replacement to this concrete update.
 */
export function planLocalVariantReplacementRestore(
    all: readonly LocalVariantReplacementMember[],
    args: RestoreLocalVariantGroupReplacementArgs
): LocalVariantReplacementPlan {
    if (!positiveInteger(args.expectedGameBananaId)) {
        throw new Error('A valid GameBanana mod id is required');
    }
    if (!positiveInteger(args.replacementGameBananaFileId)) {
        throw new Error('A valid replacement GameBanana file id is required');
    }

    const source = all.find((member) => member.id === args.sourceModId);
    if (!source) throw new Error(`Update source not found: ${args.sourceModId}`);
    if (source.merged) {
        throw new Error('Merged outputs cannot be local variant update sources');
    }
    const groupId = source.localGroupId?.trim();
    if (!groupId) throw new Error('Update source does not belong to a local variant group');
    if (source.gameBananaId !== args.expectedGameBananaId) {
        throw new Error('Update source GameBanana provenance does not match');
    }
    if (
        !positiveInteger(args.sourceGameBananaFileId) ||
        source.gameBananaFileId !== args.sourceGameBananaFileId
    ) {
        throw new Error('Update source file provenance does not match');
    }

    const replacementIds = Array.from(new Set(args.replacementModIds));
    if (replacementIds.length === 0) throw new Error('No replacement mods were provided');
    if (replacementIds.includes(source.id)) {
        throw new Error('The update source cannot also be its replacement');
    }

    const replacements = replacementIds.map((id) => {
        const member = all.find((candidate) => candidate.id === id);
        if (!member) throw new Error(`Replacement mod not found: ${id}`);
        if (member.gameBananaId !== args.expectedGameBananaId) {
            throw new Error(`Replacement GameBanana provenance does not match: ${member.name}`);
        }
        if (member.gameBananaFileId !== args.replacementGameBananaFileId) {
            throw new Error(`Replacement file provenance does not match: ${member.name}`);
        }
        if (member.merged) throw new Error(`Merged outputs cannot be update replacements: ${member.name}`);
        const currentGroup = member.localGroupId?.trim();
        if (currentGroup && currentGroup !== groupId) {
            throw new Error(`Replacement already belongs to another local variant group: ${member.name}`);
        }
        return member;
    });

    const groupMembers = all.filter((member) => member.localGroupId?.trim() === groupId);
    const profile = resolveLocalVariantGroupProfile(groupMembers);
    if (replacements.some((member) => !!member.priorityMod !== profile.priorityMod)) {
        throw new Error('Replacement priority-folder placement does not match its variant group');
    }

    const classification: LocalVariantGroupClassification = profile.classification ?? {
        lockerHero: source.lockerHero,
        lockerHeroSource: source.lockerHeroSource,
        lockerHeroVpkChecked: source.lockerHeroVpkChecked,
        // A group with no positive axis is authoritatively unassigned. Use the
        // same null sentinel as local import so the replacement is not lazily
        // reclassified into a different card on the next scan.
        globalType: source.globalType ?? null,
        globalTypeClassifierVersion: source.globalTypeClassifierVersion,
    };

    return {
        groupId,
        modName: source.name,
        classification,
        replacementMetaKeys: replacements.map((member) => member.metaKey),
    };
}
