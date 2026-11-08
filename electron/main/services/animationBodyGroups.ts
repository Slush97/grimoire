/**
 * Which body a hero shows while an animation plays. The game swaps body group choices (Seven drops his
 * gun during his ult) from events in the clip: `AE_BODYGROUP_SET_VALUE` names a group and choice index,
 * and an ID event (`TAG_..._BODYGROUP`) is looked up in the model's `CitadelEventIDToBodyGroupMapping_t`.
 * A preview shows one body throughout, so this picks the choice that is on for most of the playback.
 */

export interface ClipBodyEvents {
    durationSeconds: number;
    events: readonly unknown[];
}

export interface ModelBodyGroups {
    /** `m_meshGroups`: `<GROUP>_@<index>_#&<choice>` per choice. */
    meshGroups: readonly string[];
    defaultMask: number;
    /** `m_modelInfo.m_keyValueText`. */
    keyValueText: string;
}

/** `value` is the choice's index within its group; `index` its position in `m_meshGroups` (the mask bit). */
interface Choice { group: string; choice: string; value: number; index: number }

function parseChoices(meshGroups: readonly string[]): Choice[] {
    return meshGroups.flatMap((name, index) => {
        const match = /^(.*)_@(\d+)_#&(.*)$/.exec(name);
        return match ? [{ group: match[1].toLowerCase(), value: Number(match[2]), choice: match[3], index }] : [];
    });
}

/** `TAG_..._BODYGROUP = [ { m_sBodyGroupName = "G" m_BodygroupChoice = "C" }, ]` from the model's key values. */
export function eventBodyGroupMapping(keyValueText: string): Map<string, { group: string; choice: string }[]> {
    const mapping = new Map<string, { group: string; choice: string }[]>();
    const start = keyValueText.indexOf('CitadelEventIDToBodyGroupMapping_t');
    if (start < 0) return mapping;
    const block = keyValueText.slice(start);
    const entry = /(\w+)\s*=\s*\[([^\]]*)\]/g;
    for (let match = entry.exec(block); match; match = entry.exec(block)) {
        const settings = [...match[2].matchAll(/m_sBodyGroupName\s*=\s*"([^"]*)"\s*m_BodygroupChoice\s*=\s*"([^"]*)"/g)]
            .map(([, group, choice]) => ({ group: group.toLowerCase(), choice }));
        if (!settings.length) break; // past the mapping block
        mapping.set(match[1], settings);
    }
    return mapping;
}

const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const percent = (value: unknown): number => {
    const raw = record(value)?.m_flValue;
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
};

/**
 * The body group choice to export a preview of these clips with, or null for the default body. Event
 * times are fractions of their clip. A set event holds until the next one for its group.
 */
export function previewBodyChoice(clips: readonly ClipBodyEvents[], model: ModelBodyGroups): string | null {
    const choices = parseChoices(model.meshGroups);
    const mapping = eventBodyGroupMapping(model.keyValueText);
    const seconds = new Map<string, number>();
    let total = 0;
    for (const clip of clips) {
        total += clip.durationSeconds;
        const sets: { group: string; choice: string; at: number }[] = [];
        for (const raw of clip.events) {
            const event = record(raw);
            if (!event) continue;
            const at = percent(event.m_flStartTime);
            const id = typeof event.m_ID === 'string' ? mapping.get(event.m_ID) : undefined;
            for (const { choice } of id ?? []) {
                seconds.set(choice, (seconds.get(choice) ?? 0) + Math.min(percent(event.m_flDuration), 1 - at) * clip.durationSeconds);
            }
            const kv = record(event.m_KV);
            if (event.m_animEventClassName === 'AE_BODYGROUP_SET_VALUE' && typeof kv?.bodygroup === 'string' && typeof kv.value === 'number') {
                const group = kv.bodygroup.toLowerCase();
                const picked = choices.find((choice) => choice.group === group && choice.value === kv.value);
                if (picked) sets.push({ group, choice: picked.choice, at });
            }
        }
        sets.sort((a, b) => a.at - b.at);
        sets.forEach((set, i) => {
            const next = sets.slice(i + 1).find((later) => later.group === set.group);
            seconds.set(set.choice, (seconds.get(set.choice) ?? 0) + ((next?.at ?? 1) - set.at) * clip.durationSeconds);
        });
    }
    const defaults = new Set(choices.filter((choice) => (model.defaultMask >> choice.index) & 1).map((choice) => choice.choice));
    const [best] = [...seconds.entries()].filter(([choice]) => !defaults.has(choice)).sort((a, b) => b[1] - a[1]);
    return best && total > 0 && best[1] >= total / 2 ? best[0] : null;
}
