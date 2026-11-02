import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { PackageStack, type VpkmergeRunner } from './heroParticleSources';

it('keeps embedded block files distinct across concurrent stacks in one process', async () => {
    const root = join(process.cwd(), '.codex-run');
    await fs.mkdir(root, { recursive: true });
    const scratch = await fs.mkdtemp(join(root, 'particle-source-test-'));
    let secondArrived = () => {};
    let firstFinished = () => {};
    let firstArrived = () => {};
    const started = new Promise<void>((resolve) => { firstArrived = resolve; });
    const second = new Promise<void>((resolve) => { secondArrived = resolve; });
    const first = new Promise<void>((resolve) => { firstFinished = resolve; });
    let calls = 0;
    const paths: string[] = [];
    const runner: VpkmergeRunner = {
        async stdout(args) {
            const index = calls++;
            paths.push(args[1]);
            if (index === 0) { firstArrived(); await second; }
            else { secondArrived(); await first; }
            return JSON.stringify({ value: (await fs.readFile(args[1]))[0] });
        },
    };
    try {
        const a = new PackageStack([], runner, scratch);
        const b = new PackageStack([], runner, scratch);
        const one = a.decodeLoose(Buffer.from([1])).then((result) => { firstFinished(); return result; });
        await started;
        const two = b.decodeLoose(Buffer.from([2]));
        expect(await Promise.all([one, two])).toEqual([{ value: 1 }, { value: 2 }]);
        expect(paths[0]).not.toBe(paths[1]);
        expect(await fs.readdir(scratch)).toEqual([]);
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
});
