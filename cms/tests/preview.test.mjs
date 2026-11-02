import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createSnapshot } from '../release/create-snapshot.mjs';
import { cleanupPreviews } from '../preview/cleanup-previews.mjs';
import { createPreview } from '../preview/create-preview.mjs';
import { createPreviewAuthHandler } from '../preview/preview-auth-server.mjs';
import { createPreviewAccessUrl, createPreviewGrant, verifyPreviewGrant } from '../preview/preview-token.mjs';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const siteRoot = join(workspaceRoot, 'site');
const fixtureUrl = new URL('./fixtures/snapshot-input.json', import.meta.url);
const secret = 'preview-test-secret-with-more-than-32-characters';

async function previewInput() {
  const input = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const snapshot = createSnapshot(input);
  return {
    schema_version: 1,
    preview_id: 'pv-test-preview',
    created_at: '2026-10-22T10:00:00.000Z',
    source_commit: '0123456789abcdef',
    content: snapshot.content,
  };
}

test('preview grants are bounded, signed and expiry checked', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');
  const grant = createPreviewGrant(secret, 'pv-test-preview', { ttlSeconds: 600, now });
  assert.equal(verifyPreviewGrant(secret, grant.token, { now: now + 1000 }).valid, true);
  assert.equal(verifyPreviewGrant(secret, `${grant.token}x`, { now: now + 1000 }).valid, false);
  assert.equal(verifyPreviewGrant(secret, grant.token, { now: now + 601_000 }).code, 'PREVIEW_TOKEN_EXPIRED');
  assert.match(createPreviewAccessUrl('https://preview.diarwiki.ru', grant), /^https:\/\/preview\.diarwiki\.ru\/access\?/u);
  assert.throws(() => createPreviewGrant(secret, 'pv-test-preview', { ttlSeconds: 90_000, now }), /PREVIEW_TTL_INVALID/u);
});

test('preview build is isolated, noindex, token-free and expires cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diarwiki-preview-'));
  const now = Date.parse('2026-10-22T10:00:00Z');
  try {
    const result = await createPreview(await previewInput(), {
      previewRoot: root, siteRoot, workspaceRoot, secret,
      origin: 'https://preview.diarwiki.ru', ttlSeconds: 600, now,
      async build(tempSite) {
        const generated = await readFile(join(tempSite, 'src', 'content', 'docs', 'insulin-basics.mdx'), 'utf8');
        assert.match(generated, /^status: "draft"$/mu);
        await mkdir(join(tempSite, 'dist', 'downloads'), { recursive: true });
        await writeFile(join(tempSite, 'dist', 'index.html'), '<!doctype html><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><h1>Предпросмотр</h1>', 'utf8');
        await writeFile(join(tempSite, 'dist', 'downloads', 'static.html'), '<!doctype html><head><title>Файл</title></head>', 'utf8');
      },
      async publish(source, target) { await cp(source, target, { recursive: true, errorOnExist: true, force: false }); },
    });
    const html = await readFile(join(root, 'p', 'pv-test-preview', 'index.html'), 'utf8');
    const staticHtml = await readFile(join(root, 'p', 'pv-test-preview', 'downloads', 'static.html'), 'utf8');
    assert.equal(html.includes(secret), false);
    assert.equal(html.includes(new URL(result.accessUrl).searchParams.get('signature')), false);
    assert.match(staticHtml, /name="robots" content="noindex,nofollow"/u);
    assert.match(staticHtml, /name="referrer" content="no-referrer"/u);
    const early = await cleanupPreviews(root, { now: now + 300_000 });
    assert.deepEqual(early.removed, []);
    const late = await cleanupPreviews(root, { now: now + 601_000 });
    assert.deepEqual(late.removed, ['pv-test-preview']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('authorization exchanges the query signature for an HttpOnly cookie', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diarwiki-preview-auth-'));
  await mkdir(join(root, 'p', 'pv-test-preview'), { recursive: true });
  const origin = 'https://preview.diarwiki.ru';
  const handler = createPreviewAuthHandler({ secret, previewRoot: root, origin });
  const request = (url, headers = {}) => new Promise((resolvePromise) => {
    const responseHeaders = new Map();
    const response = {
      statusCode: 200,
      setHeader(name, value) { responseHeaders.set(name.toLowerCase(), value); },
      writeHead(status, extra = {}) {
        this.statusCode = status;
        for (const [name, value] of Object.entries(extra)) responseHeaders.set(name.toLowerCase(), value);
      },
      end(body = '') { resolvePromise({ status: this.statusCode, headers: responseHeaders, body }); },
    };
    handler({ url, headers }, response);
  });
  try {
    const grant = createPreviewGrant(secret, 'pv-test-preview', { ttlSeconds: 600 });
    const accessUrl = new URL(createPreviewAccessUrl(origin, grant));
    const access = await request(`${accessUrl.pathname}${accessUrl.search}`);
    assert.equal(access.status, 303);
    assert.equal(access.headers.get('location'), '/');
    const cookie = access.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/u);
    const authorized = await request('/authorize', { cookie: cookie.split(';', 1)[0] });
    assert.equal(authorized.status, 204);
    assert.equal(authorized.headers.get('x-preview-id'), 'pv-test-preview');
    const denied = await request('/authorize');
    assert.equal(denied.status, 401);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preview proxy and services keep authorization and files isolated', async () => {
  const caddy = await readFile(new URL('../preview/Caddyfile.preview', import.meta.url), 'utf8');
  const service = await readFile(new URL('../preview/diarwiki-preview.service', import.meta.url), 'utf8');
  const timer = await readFile(new URL('../preview/diarwiki-preview-cleanup.timer', import.meta.url), 'utf8');
  assert.match(caddy, /forward_auth 127\.0\.0\.1:8061/u);
  assert.match(caddy, /copy_headers X-Preview-Id/u);
  assert.match(caddy, /rewrite \* \/p\/\{http\.request\.header\.X-Preview-Id\}\{uri\}/u);
  assert.match(caddy, /X-Robots-Tag "noindex, nofollow, noarchive"/u);
  assert.match(caddy, /Cache-Control "private, no-store"/u);
  assert.match(service, /ProtectSystem=strict/u);
  assert.match(service, /ReadWritePaths=\/srv\/diarwiki-previews/u);
  assert.match(timer, /OnUnitActiveSec=15min/u);
});
