import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deploy = new URL('../deploy/', import.meta.url);
const text = (name) => readFile(new URL(name, deploy), 'utf8');

test('CMS reverse proxy has TLS-domain security headers and loopback upstream', async () => {
  const caddy = await text('Caddyfile.cms');
  assert.match(caddy, /^cms\.diarwiki\.ru \{/mu);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8055/u);
  for (const header of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Robots-Tag', 'X-Frame-Options']) assert.match(caddy, new RegExp(header, 'u'));
});

test('backups are encrypted, verified and copied off-server before local rotation', async () => {
  const backup = await text('backup-cms.sh');
  const remote = backup.indexOf('rclone check');
  const rotation = backup.indexOf("-mtime +14 -delete");
  assert.match(backup, /pg_dump --format=custom/u);
  assert.match(backup, /age --encrypt/u);
  assert.match(backup, /age --decrypt/u);
  assert.match(backup, /diarwiki-cms-weekly-/u);
  assert.match(backup, /find uploads -type f/u);
  assert.ok(remote > 0 && rotation > remote);
});

test('restore requires explicit destructive confirmation and verifies all checksums', async () => {
  const restore = await text('restore-cms.sh');
  assert.match(restore, /--confirm-destructive-restore/u);
  assert.match(restore, /sha256sum --check/u);
  assert.match(restore, /pg_restore --no-owner --no-acl --exit-on-error/u);
  assert.match(restore, /verify-cms\.sh/u);
});

test('backup timer is persistent and installation does not enable it prematurely', async () => {
  const timer = await text('diarwiki-cms-backup.timer');
  const install = await text('install-cms.sh');
  assert.match(timer, /Persistent=true/u);
  assert.doesNotMatch(install, /systemctl enable/u);
});
