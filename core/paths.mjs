import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Subdirectories every command depends on.
 *
 * `reports` arrived in v0.3. A data directory created by v0.2 only has `runs`
 * and `outbox`, so `generate` died with ENOENT when it wrote the review report.
 * Creating these on every run -- not only in `init` -- removes the dependency on
 * anyone remembering to re-run init after an upgrade.
 */
export const DATA_SUBDIRS = ['runs', 'outbox', 'reports'];

/** Idempotent. Returns the subdirectories that had to be created. */
export function ensureDataDirectories(dataDirectory) {
  const created = [];
  mkdirSync(dataDirectory, { recursive: true });
  for (const name of DATA_SUBDIRS) {
    const path = join(dataDirectory, name);
    // mkdirSync returns the first path created, or undefined if it existed.
    if (mkdirSync(path, { recursive: true }) !== undefined) created.push(name);
  }
  return created;
}
