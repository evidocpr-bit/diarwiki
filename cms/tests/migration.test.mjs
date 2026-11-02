import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createMigrationBundle } from '../migration/import-current-content.mjs';
import { applyMigrationBundle } from '../migration/apply-bundle.mjs';
import { parseAttributes, parseLiteral, parseMdxDocument } from '../migration/parse-mdx.mjs';
import { createMigrationReport } from '../migration/report.mjs';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

test('safe literal parser accepts data and rejects executable expressions', () => {
  assert.deepEqual(parseLiteral("[{ label: 'Один' }, { label: 'Два', note: 'Текст' }]"), [
    { label: 'Один' }, { label: 'Два', note: 'Текст' },
  ]);
  assert.throws(() => parseLiteral('process.exit(1)'), /MDX_LITERAL_UNSUPPORTED/u);
  assert.throws(() => parseLiteral('(() => 1)()'), /MDX_LITERAL_UNSUPPORTED/u);
});

test('MDX parser preserves metadata and structured components without evaluating code', () => {
  const parsed = parseMdxDocument(`---
title: "Проверка"
description: Описание материала достаточно длинное
summary: Краткое содержание материала
contentId: article-test
audience: [взрослые, близкие]
updatedAt: 2026-10-22
---

import QuickAnswer from '../QuickAnswer.astro';

<QuickAnswer title="Коротко">Текст **ответа**.</QuickAnswer>

Обычный [текст](/contact/).
`);
  assert.equal(parsed.frontmatter.contentId, 'article-test');
  assert.deepEqual(parsed.frontmatter.audience, ['взрослые', 'близкие']);
  assert.equal(parsed.tokens[0].name, 'QuickAnswer');
  assert.equal(parsed.tokens[0].attributes.title, 'Коротко');
  assert.match(parsed.tokens[0].html, /<strong>ответа<\/strong>/u);
  assert.equal(parsed.tokens[1].kind, 'markdown');
});

test('attribute parser handles multiline safe data literals', () => {
  assert.deepEqual(parseAttributes(` title="Схема" items={[
    { label: 'Начало' },
    { label: 'Конец', note: 'Пояснение' },
  ]} reverse={true}`), {
    title: 'Схема',
    items: [{ label: 'Начало' }, { label: 'Конец', note: 'Пояснение' }],
    reverse: true,
  });
});

test('current site migration is complete, deterministic and safe to stage', async () => {
  const first = await createMigrationBundle(workspaceRoot, { sourceCommit: 'test-commit' });
  const second = await createMigrationBundle(workspaceRoot, { sourceCommit: 'test-commit' });
  const report = createMigrationReport(first);

  assert.equal(first.collections.materials.length, 15);
  assert.equal(first.collections.library_items.length, 49);
  assert.equal(first.collections.pages.length, 7);
  assert.equal(first.collections.media_metadata.length, 10);
  assert.equal(first.collections.material_blocks.length, 184);
  assert.deepEqual(
    first.collections.materials.map(({ id, content_id }) => ({ id, content_id })),
    second.collections.materials.map(({ id, content_id }) => ({ id, content_id })),
  );
  assert.ok(first.collections.media_metadata.every((media) => media.security_status === 'passed'));
  assert.ok(first.collections.media_metadata.every((media) => media.rights_status === 'pending'));
  assert.ok(first.collections.materials.every((material) => material.medical_review_status === 'pending'));
  assert.equal(report.problems.length, 0);
  assert.equal(report.safe_to_apply, true);
  assert.equal(report.safe_to_publish, false);
});

test('Directus staging apply requires an empty target and translates M2A blocks', async () => {
  const bundle = await createMigrationBundle(workspaceRoot, { sourceCommit: 'test-commit' });
  const requests = [];
  let fileNumber = 0;
  const fakeFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ path: parsed.pathname, search: parsed.search, method: options.method ?? 'GET', body: options.body });
    if ((options.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ data: [{ count: { id: '0' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (parsed.pathname === '/files' && options.method === 'POST') {
      fileNumber += 1;
      return new Response(JSON.stringify({ data: { id: `file-${fileNumber}` } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(
    applyMigrationBundle(bundle, { baseUrl: 'https://cms.example.test', token: 'secret', workspaceRoot, fetchImplementation: fakeFetch }),
    /CONFIRM_EMPTY_REQUIRED/u,
  );
  const result = await applyMigrationBundle(bundle, {
    baseUrl: 'https://cms.example.test', token: 'secret', workspaceRoot,
    fetchImplementation: fakeFetch, confirmEmpty: true,
  });
  assert.ok(result.created > 100);
  const blockRequest = requests.find(({ path, method }) => path === '/items/material_blocks' && method === 'POST');
  const blocks = JSON.parse(blockRequest.body);
  assert.equal(typeof blocks[0].collection, 'string');
  assert.equal(typeof blocks[0].item, 'string');
});
