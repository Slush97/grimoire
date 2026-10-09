import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { nightlyVersion } from './nightly-version.mjs';

const require = createRequire(import.meta.url);
const semver = createRequire(require.resolve('electron-updater'))('semver');
const sha = 'abcdef01'.repeat(5);

test('a nightly updates an unchanged stable version and identifies its commit', () => {
  const version = nightlyVersion('1.31.0', sha, '42', new Date('2026-10-09T12:30:00Z'));
  assert.equal(version, '1.31.1-nightly.20261009123000.42.gabcdef0');
  assert.ok(semver.valid(version));
  assert.ok(semver.gt(version, '1.31.0'));
  assert.ok(semver.lt(version, '1.31.1'));
});

test('successive builds and reruns sort in build order', () => {
  const date = new Date('2026-10-09T12:30:00Z');
  const first = nightlyVersion('1.31.0', sha, 9, date);
  const next = nightlyVersion('1.31.0', sha, 10, date);
  const rerun = nightlyVersion('1.31.0', sha, 9, new Date('2026-10-09T12:31:00Z'));
  assert.ok(semver.gt(next, first));
  assert.ok(semver.gt(rerun, next));
});

test('invalid metadata fails instead of publishing an unusable version', () => {
  assert.throws(() => nightlyVersion('garbage', sha, 1));
  assert.throws(() => nightlyVersion('1.31.0', 'main', 1));
  assert.throws(() => nightlyVersion('1.31.0', sha, '0'));
});
