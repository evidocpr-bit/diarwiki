import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeReviewSet,
  createReviewFingerprint,
  normalizeReviewSet,
} from '../src/review-fingerprint.ts';

const base = {
  material: {
    id: 'internal-id',
    content_id: 'insulin-basics',
    slug: 'insulin-basics',
    title: '  Инсулин\r\nбез страха  ',
    description: 'Введение',
    summary: 'Кратко',
    risk: 'high',
    disclaimer_scope: 'treatment',
    topics: ['инсулин', 'лечение'],
    audiences: ['adult'],
    responsible_editor: 'private-user-id',
    updated_at: '2026-10-22T04:03:02+00:00',
  },
  blocks: [
    { id: 'b2', sort_order: 2, block_type: 'rich_text', item: { body: 'Второй' } },
    { id: 'b1', sort_order: 1, block_type: 'medical_notice', item: { body: 'Первый' } },
  ],
  sources: [
    { id: 's2', source_id: 'who', title: 'WHO', url: 'https://example.test/who' },
    { id: 's1', source_id: 'ada', title: 'ADA', url: 'https://example.test/ada' },
  ],
  media: [
    { id: 'm1', sha256: 'abc', alt_text: 'Схема', caption: 'Подпись', internal_note: 'private' },
  ],
  related: [{ content_id: 'hypoglycemia', title: 'Гипогликемия' }],
};

test('fingerprint is stable across object key order, Unicode form, line endings and source order', () => {
  const decomposed = `Инсулин\nбез страха`.normalize('NFD');
  const variant = structuredClone(base);
  variant.material = {
    ...variant.material,
    title: decomposed,
  };
  variant.sources.reverse();
  variant.blocks.reverse();

  assert.equal(createReviewFingerprint(base), createReviewFingerprint(variant));
});

test('internal fields do not affect the fingerprint', () => {
  const changed = structuredClone(base);
  changed.material.responsible_editor = 'somebody-else';
  changed.material.updated_at = '2030-01-01T00:00:00Z';
  changed.media[0].internal_note = 'changed';

  assert.equal(createReviewFingerprint(base), createReviewFingerprint(changed));
});

test('reviewed text, block order, source content and media hash affect the fingerprint', () => {
  for (const mutate of [
    (value: typeof base) => { value.material.summary = 'Другое'; },
    (value: typeof base) => { value.blocks[0].sort_order = 0; },
    (value: typeof base) => { value.sources[0].title = 'Обновлённый источник'; },
    (value: typeof base) => { value.media[0].sha256 = 'def'; },
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.notEqual(createReviewFingerprint(base), createReviewFingerprint(changed));
  }
});

test('normalization retains only the documented review surface', () => {
  const normalized = normalizeReviewSet(base);
  assert.equal('id' in normalized.material, false);
  assert.equal('responsible_editor' in normalized.material, false);
  assert.equal('internal_note' in normalized.media[0], false);
  assert.deepEqual(normalized.blocks.map((block) => block.id), ['b1', 'b2']);
  assert.deepEqual(normalized.sources.map((source) => source.source_id), ['ada', 'who']);
});

test('canonical output is compact, deterministic JSON and ISO dates are UTC', () => {
  const value = canonicalizeReviewSet({
    material: { ...base.material, public_updated_at: '2026-10-22T14:03:02+10:00' },
    blocks: [], sources: [], media: [], related: [],
  });
  assert.equal(value.includes('\r'), false);
  assert.equal(value.includes('2026-10-22T04:03:02.000Z'), true);
  assert.equal(value.includes('\n  '), false);
});
