import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const RUN = randomUUID().slice(0, 8);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TEMP = new RegExp(`^\\.[a-z-]+-([0-9a-f]{8})-${UUID}\\.tmp$`);
const RELEASED_TEMP = new RegExp(`^\\.(?:merge-rebuild|imprint-embed)-${UUID}\\.vpk$`);

/**
 * Same-folder staging path for an archive that a merge, rebuild, imprint or
 * import inspects and then commits by rename. Never a mod name: it does not
 * end in `.vpk`.
 */
export function modTempPath(folder: string, kind: string): string {
    return join(folder, `.${kind}-${RUN}-${randomUUID()}.tmp`);
}

/**
 * A staging temp an earlier run left behind (a crash, or quitting while a
 * safety review was pending). This run's temps are never stale, however old:
 * a review or the inspection queue can hold one for any length of time.
 */
export function isStaleModTemp(fileName: string): boolean {
    const match = TEMP.exec(fileName);
    return match ? match[1] !== RUN : RELEASED_TEMP.test(fileName);
}
