import { randomUUID } from 'node:crypto';
import { open, readFile, rm, stat } from 'node:fs/promises';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export class ReleaseLockError extends Error {
  constructor(code) { super(code); this.name = 'ReleaseLockError'; this.code = code; }
}

export async function acquireReleaseLock(path, options = {}) {
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? 30 * 60 * 1000;
  const nonce = randomUUID();
  const payload = { schema_version: 1, pid: process.pid, nonce, acquired_at: new Date(now).toISOString() };
  async function create() {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.close();
  }
  try {
    await create();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const details = await Promise.all([readFile(path, 'utf8').catch(() => '{}'), stat(path).catch(() => null)]);
    let current = {};
    try { current = JSON.parse(details[0]); } catch { /* A stale truncated lock is recoverable. */ }
    const age = details[1] ? now - details[1].mtimeMs : 0;
    if (age <= staleAfterMs || processAlive(Number(current.pid))) throw new ReleaseLockError('RELEASE_ALREADY_RUNNING');
    await rm(path, { force: false });
    try { await create(); } catch (retryError) {
      if (retryError.code === 'EEXIST') throw new ReleaseLockError('RELEASE_ALREADY_RUNNING');
      throw retryError;
    }
  }

  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      const current = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
      if (current.nonce !== nonce) throw new ReleaseLockError('RELEASE_LOCK_OWNERSHIP_LOST');
      await rm(path, { force: false });
      released = true;
    },
  };
}
