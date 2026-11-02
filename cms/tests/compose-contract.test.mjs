import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { validateComposeText } from '../scripts/validate-compose.mjs';

const composeUrl = new URL('../compose.yaml', import.meta.url);

test('the committed compose file satisfies the CMS isolation contract', async () => {
  const source = await readFile(composeUrl, 'utf8');
  const result = validateComposeText(source);

  assert.deepEqual(result.problems, []);
});

test('rejects floating images and a publicly exposed database', () => {
  const source = `
services:
  postgres:
    image: postgres:latest
    ports:
      - "5432:5432"
  directus:
    image: directus/directus:latest
    ports:
      - "8055:8055"
networks:
  cms-backend: {}
`;
  const { problems } = validateComposeText(source);
  const codes = new Set(problems.map(({ code }) => code));

  assert.ok(codes.has('floating_image'));
  assert.ok(codes.has('postgres_exposed'));
  assert.ok(codes.has('directus_not_loopback'));
});

test('requires health checks, restart policy, and no-new-privileges', () => {
  const source = `
services:
  postgres:
    image: \${POSTGRES_IMAGE}
  directus:
    image: \${DIRECTUS_IMAGE}
    ports:
      - "127.0.0.1:8055:8055"
networks:
  cms-backend:
    internal: true
`;
  const { problems } = validateComposeText(source);
  const codes = new Set(problems.map(({ code }) => code));

  assert.ok(codes.has('healthcheck_missing'));
  assert.ok(codes.has('restart_policy_missing'));
  assert.ok(codes.has('no_new_privileges_missing'));
});

test('requires an internal database network and persistent named volumes', () => {
  const source = `
services:
  postgres:
    image: \${POSTGRES_IMAGE}
    healthcheck: { test: ["CMD", "true"] }
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
  directus:
    image: \${DIRECTUS_IMAGE}
    ports: ["127.0.0.1:8055:8055"]
    healthcheck: { test: ["CMD", "true"] }
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
networks:
  cms-backend: {}
`;
  const { problems } = validateComposeText(source);
  const codes = new Set(problems.map(({ code }) => code));

  assert.ok(codes.has('backend_not_internal'));
  assert.ok(codes.has('persistent_volume_missing'));
});

test('requires critical Directus environment mappings without literal secrets', () => {
  const source = `
services:
  postgres:
    image: \${POSTGRES_IMAGE}
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    healthcheck: { test: ["CMD", "true"] }
    volumes: ["cms-postgres:/var/lib/postgresql/data"]
  directus:
    image: \${DIRECTUS_IMAGE}
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    healthcheck: { test: ["CMD", "true"] }
    ports: ["127.0.0.1:8055:8055"]
    volumes:
      - cms-uploads:/directus/uploads
    environment:
      SECRET: "hard-coded-secret"
networks:
  cms-backend:
    internal: true
volumes:
  cms-postgres:
  cms-uploads:
`;
  const { problems } = validateComposeText(source);
  const codes = new Set(problems.map(({ code }) => code));

  assert.ok(codes.has('environment_mapping_missing'));
  assert.ok(codes.has('literal_secret'));
});

test('requires an explicit local media root, upload cap, and MIME allowlist', async () => {
  const source = await readFile(composeUrl, 'utf8');
  const weakened = source
    .replace(/^\s+STORAGE_LOCAL_ROOT:.*$/mu, '')
    .replace(/^\s+FILES_MAX_UPLOAD_SIZE:.*$/mu, '')
    .replace(/^\s+FILES_MIME_TYPE_ALLOW_LIST:.*$/mu, '');
  const { problems } = validateComposeText(weakened);
  assert.ok(problems.some(({ code }) => code === 'media_policy_missing'));
});
