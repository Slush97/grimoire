// The video.txt half of a preset has no inline markers (Deadlock rewrites the
// file without them), so the guarantees live here: apply then revert gives the
// user's file back byte for byte, and revert never touches a value the user or
// the game changed after Grimoire wrote it.
import { describe, expect, it } from 'vitest';
import { applyVideo, revertVideo, videoApplied } from './performanceVideo';

const VIDEO = `"video.cfg"
{
\t"Version"\t\t"20"
\t"VendorID"\t\t"4318"
\t"DeviceID"\t\t"11269"
\t"setting.cpu_level"\t\t"2"
\t"setting.defaultres"\t\t"2560"
\t"setting.defaultresheight"\t\t"1440"
\t"setting.r_citadel_ssao_quality"\t\t"3"
\t"setting.r_effects_bloom"\t\t"true"
\t"setting.mat_viewportscale"\t\t"0.750000"
\t"setting.r_texture_stream_mip_bias"\t\t"0"
}
`;
const VIDEO_CRLF = VIDEO.split('\n').join('\r\n');

const SETTINGS: Array<[string, string]> = [
    ['cpu_level', '1'],
    ['r_citadel_ssao_quality', '0'],
    ['r_effects_bloom', 'false'],
    ['r_shadows', '0'],
    ['r_texture_stream_mip_bias', '4'],
];

function applied(text: string, settings = SETTINGS) {
    const result = applyVideo(text, settings);
    if (!result.ok) throw new Error(result.error);
    return result;
}

describe('applyVideo', () => {
    it('edits existing settings in place and adds missing ones before the brace', () => {
        const { text } = applied(VIDEO);
        expect(text).toContain('\t"setting.cpu_level"\t\t"1"\n');
        expect(text).toContain('\t"setting.r_effects_bloom"\t\t"false"\n');
        expect(text).toMatch(/\t"setting\.r_shadows"\t\t"0"\n\}\n$/);
        expect(text.split('\n')).toHaveLength(VIDEO.split('\n').length + 1);
    });

    it('records what it replaced, including keys that were absent', () => {
        const { state } = applied(VIDEO);
        expect(state.original).toEqual({
            cpu_level: '2',
            r_citadel_ssao_quality: '3',
            r_effects_bloom: 'true',
            r_shadows: null,
            r_texture_stream_mip_bias: '0',
        });
        expect(state.written.r_shadows).toBe('0');
    });

    it('does not record a key that already holds the preset value', () => {
        const { state } = applied(VIDEO, [['cpu_level', '2']]);
        expect(state.written).toEqual({});
    });

    it('never touches the header or settings it was not given', () => {
        const { text } = applied(VIDEO);
        for (const line of ['"DeviceID"\t\t"11269"', '"setting.defaultres"\t\t"2560"', '"setting.mat_viewportscale"\t\t"0.750000"']) {
            expect(text).toContain(line);
        }
    });

    it('refuses a file that is not shaped like Deadlock writes it', () => {
        expect(applyVideo('', SETTINGS).ok).toBe(false);
        expect(applyVideo('"setting.cpu_level" "2"', SETTINGS).ok).toBe(false);
    });

    it('keeps CRLF line endings', () => {
        const { text } = applied(VIDEO_CRLF);
        expect(text.split('\r\n').join('').includes('\n')).toBe(false);
        expect(text).toContain('\t"setting.r_shadows"\t\t"0"\r\n}');
    });
});

describe('revertVideo', () => {
    it('round-trips byte for byte', () => {
        for (const original of [VIDEO, VIDEO_CRLF]) {
            const { text, state } = applied(original);
            expect(revertVideo(text, state)).toBe(original);
        }
    });

    it('leaves a value the user changed after the apply', () => {
        const { text, state } = applied(VIDEO);
        const edited = text.replace('"setting.cpu_level"\t\t"1"', '"setting.cpu_level"\t\t"3"');
        const reverted = revertVideo(edited, state);
        expect(reverted).toContain('"setting.cpu_level"\t\t"3"');
        expect(reverted).toContain('"setting.r_effects_bloom"\t\t"true"');
    });

    it('copes with the game rewriting the file without the keys it does not know', () => {
        const { text, state } = applied(VIDEO);
        const rewritten = text.replace(/\t"setting\.r_shadows".*\n/, '');
        expect(revertVideo(rewritten, state)).toBe(VIDEO);
    });

    it('reapplying from the reverted text keeps the pre-Grimoire originals', () => {
        const first = applied(VIDEO);
        const second = applied(revertVideo(first.text, first.state));
        expect(second.state).toEqual(first.state);
        expect(second.text).toBe(first.text);
    });
});

describe('videoApplied', () => {
    it('counts the written values the file still holds', () => {
        const { text, state } = applied(VIDEO);
        expect(videoApplied(text, state)).toBe(SETTINGS.length);
        const changed = text.replace('"setting.cpu_level"\t\t"1"', '"setting.cpu_level"\t\t"2"');
        expect(videoApplied(changed, state)).toBe(SETTINGS.length - 1);
    });
});
