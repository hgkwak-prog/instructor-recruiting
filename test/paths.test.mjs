import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_SUBDIRS, ensureDataDirectories } from '../core/paths.mjs';

test('creates every subdirectory from nothing', () => {
  const data = join(mkdtempSync(join(tmpdir(), 'paths-')), 'data');
  assert.deepEqual(ensureDataDirectories(data).sort(), [...DATA_SUBDIRS].sort());
  for (const name of DATA_SUBDIRS) assert.ok(existsSync(join(data, name)), name);
});

test('adds only what a v0.2 data directory is missing', () => {
  // v0.2는 runs와 outbox만 만들었다. reports는 v0.3에서 생겼고,
  // init을 다시 돌리지 않으면 generate가 ENOENT로 죽었다.
  const data = join(mkdtempSync(join(tmpdir(), 'paths-v02-')), 'data');
  mkdirSync(join(data, 'runs'), { recursive: true });
  mkdirSync(join(data, 'outbox'), { recursive: true });
  assert.ok(!existsSync(join(data, 'reports')));

  assert.deepEqual(ensureDataDirectories(data), ['reports']);
  assert.ok(existsSync(join(data, 'reports')));
});

test('is idempotent and reports nothing on a second call', () => {
  const data = join(mkdtempSync(join(tmpdir(), 'paths-idem-')), 'data');
  ensureDataDirectories(data);
  assert.deepEqual(ensureDataDirectories(data), []);
});
