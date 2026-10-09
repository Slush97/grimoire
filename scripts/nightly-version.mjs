import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function nightlyVersion(baseVersion, sha, runNumber, date = new Date()) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(baseVersion);
  if (!match || !/^[a-f0-9]{40}$/.test(sha) || !/^[1-9]\d*$/.test(String(runNumber))) {
    throw new Error('Nightly requires a valid base version, full commit SHA and positive run number.');
  }
  const stamp = date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  // main may still have the just-released version. Its next patch prerelease
  // sorts above that stable version and below the next stable patch.
  const patch = Number(match[3]) + 1;
  if (!Number.isSafeInteger(patch)) throw new Error('Invalid patch version.');
  return `${match[1]}.${match[2]}.${patch}-nightly.${stamp}.${runNumber}.g${sha.slice(0, 7)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(nightlyVersion(version, process.env.NIGHTLY_SHA, process.env.GITHUB_RUN_NUMBER));
}
