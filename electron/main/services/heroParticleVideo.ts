import { promises as fs } from 'node:fs';

/** The engine's native post-bloom switch. Missing settings retain the existing preview default. */
export function heroPostBloomFromVideo(text: string): boolean {
    let enabled = true;
    for (const match of text.matchAll(/^[\t ]*"setting\.r_post_bloom"[\t ]+"(true|false|1|0)"/gim)) {
        enabled = /^(true|1)$/i.test(match[1]);
    }
    return enabled;
}

export async function readHeroPostBloom(videoPath: string): Promise<boolean> {
    return heroPostBloomFromVideo(await fs.readFile(videoPath, 'utf8').catch(() => ''));
}
