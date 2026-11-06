import { z } from 'zod';

const rigSchema = z.object({
    nodes: z.array(z.object({ name: z.string().optional(), children: z.array(z.number().int().nonnegative()).optional() })),
    animations: z.array(z.object({ channels: z.array(z.object({ target: z.object({ node: z.number().int().nonnegative() }) })) })).default([]),
});

/** A donor may omit skin-only cloth and prop bones. Shared animated bones must
 * keep their parents, and nearly all donor tracks must resolve on the skin.
 * A skin may also leave out a dangling chain the hero carries (a ponytail, a
 * jiggle bone): an unbranched run of donor bones hanging off a bone the skin
 * has. Its tracks have nothing to move, so they do not count against the skin.
 * A missing branch (a spine with arms under it) still counts in full. */
export function compatibleHeroAnimationRig(targetJson: unknown, donorJson: unknown): boolean {
    const parsedTarget = rigSchema.safeParse(targetJson);
    const parsedDonor = rigSchema.safeParse(donorJson);
    if (!parsedTarget.success || !parsedDonor.success) return false;
    const target = parsedTarget.data;
    const donor = parsedDonor.data;
    const parents = (rig: z.infer<typeof rigSchema>) => {
        const result = new Map<string, string | undefined>();
        for (const node of rig.nodes) {
            if (node.name) result.set(node.name, undefined);
        }
        for (const node of rig.nodes) {
            for (const index of node.children ?? []) {
                const child = rig.nodes[index]?.name;
                if (child) result.set(child, node.name);
            }
        }
        return result;
    };
    const targetParents = parents(target);
    const donorParents = parents(donor);
    const animated = new Set(donor.animations.flatMap((clip) => clip.channels.map((channel) => donor.nodes[channel.target.node]?.name)));
    if (animated.has(undefined) || animated.size < 2) return false;
    const donorChildren = new Map<string, string[]>();
    for (const node of donor.nodes) {
        if (node.name) donorChildren.set(node.name, (node.children ?? []).flatMap((index) => donor.nodes[index]?.name ?? []));
    }
    const unbranched = (name: string): boolean => {
        const children = donorChildren.get(name) ?? [];
        return children.length === 0 || (children.length === 1 && unbranched(children[0]));
    };
    const danglingChain = (name: string): boolean => {
        let root = name;
        for (let parent = donorParents.get(root); parent !== undefined && !targetParents.has(parent); parent = donorParents.get(root)) root = parent;
        return donorParents.get(root) !== undefined && unbranched(root);
    };
    let matched = 0;
    let counted = 0;
    for (const name of animated) {
        if (!name) return false;
        if (!targetParents.has(name)) {
            if (!danglingChain(name)) counted++;
            continue;
        }
        if (targetParents.get(name) !== donorParents.get(name)) return false;
        matched++;
        counted++;
    }
    return matched >= 2 && matched / counted >= 0.9;
}
