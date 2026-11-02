import { expect, it } from 'vitest';
import { heroPostBloomFromVideo } from './heroParticleVideo';

it('honors the native post-bloom switch, including last occurrence and commented lines', () => {
    expect(heroPostBloomFromVideo('\t"setting.r_post_bloom"\t"false"\r\n')).toBe(false);
    expect(heroPostBloomFromVideo('"setting.r_post_bloom" "0"\n"setting.r_post_bloom" "true"')).toBe(true);
    expect(heroPostBloomFromVideo('// "setting.r_post_bloom" "false"')).toBe(true);
    expect(heroPostBloomFromVideo('"setting.r_effects_bloom" "false"')).toBe(true);
});
