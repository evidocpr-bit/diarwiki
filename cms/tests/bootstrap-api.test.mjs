import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DirectusApi, managedDescription, managedKey } from '../bootstrap/directus-api.mjs';

test('managed Directus descriptions keep a stable local key', () => {
  const description = managedDescription('medical-review', 'Проверка врачом');
  assert.equal(description, '[diarwiki:medical-review] Проверка врачом');
  assert.equal(managedKey(description), 'medical-review');
  assert.equal(managedKey('Обычная политика'), undefined);
});

test('DirectusApi sends the token in the header and returns only response data', async () => {
  let captured;
  const api = new DirectusApi('https://cms.example.test', 'private-token', async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ data: { id: 'policy-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const result = await api.post('/policies', { name: 'Policy' });
  assert.deepEqual(result, { id: 'policy-1' });
  assert.equal(captured.url, 'https://cms.example.test/policies');
  assert.equal(captured.options.headers.authorization, 'Bearer private-token');
  assert.equal(captured.options.method, 'POST');
});

test('DirectusApi errors never include the bootstrap token or response body', async () => {
  const token = 'must-not-leak';
  const api = new DirectusApi('https://cms.example.test', token, async () =>
    new Response(JSON.stringify({ errors: [{ message: `token=${token}` }] }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));

  await assert.rejects(
    () => api.get('/policies'),
    (error) => {
      assert.doesNotMatch(error.message, /must-not-leak/u);
      assert.equal(error.message, 'Directus API GET /policies: HTTP 403');
      return true;
    },
  );
});

test('DirectusApi raw fetch keeps authorization for protected assets', async () => {
  let captured;
  const api = new DirectusApi('https://cms.example.test', 'asset-token', async (url, options) => {
    captured = { url: String(url), options };
    return new Response('image-bytes');
  });
  const response = await api.fetch('/assets/file-1');
  assert.equal(await response.text(), 'image-bytes');
  assert.equal(captured.url, 'https://cms.example.test/assets/file-1');
  assert.equal(captured.options.headers.authorization, 'Bearer asset-token');
});
