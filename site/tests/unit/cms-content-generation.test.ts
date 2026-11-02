import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createSnapshot } from '../../../cms/release/create-snapshot.mjs';
import { generateContent } from '../../scripts/cms/generate-content.mjs';
import { renderBlocks } from '../../scripts/cms/render-blocks.mjs';
import { validateGeneratedContent } from '../../scripts/cms/validate-generated.mjs';

const inputUrl = new URL('../../../cms/tests/fixtures/snapshot-input.json', import.meta.url);
const maliciousUrl = new URL('../fixtures/cms-snapshot/malicious-blocks.json', import.meta.url);

async function json(url: URL) {
  return JSON.parse(await readFile(url, 'utf8'));
}

describe('CMS content generation', () => {
  it('preserves stable content IDs and emits a valid Astro collection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diarwiki-generated-'));
    try {
      const snapshot = createSnapshot(await json(inputUrl));
      const result = await generateContent(snapshot, root);
      expect(result.materialCount).toBe(1);
      const mdx = await readFile(join(root, 'docs', 'insulin-basics.mdx'), 'utf8');
      expect(mdx).toContain('contentId: "insulin-basics"');
      expect(mdx).toContain('sourceIds: ["who-diabetes"]');
      expect((await validateGeneratedContent(root)).problems).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('produces byte-identical files from the same snapshot', async () => {
    const left = await mkdtemp(join(tmpdir(), 'diarwiki-generated-a-'));
    const right = await mkdtemp(join(tmpdir(), 'diarwiki-generated-b-'));
    try {
      const snapshot = createSnapshot(await json(inputUrl));
      await generateContent(snapshot, left);
      await generateContent(snapshot, right);
      const a = await readFile(join(left, 'docs', 'insulin-basics.mdx'), 'utf8');
      const b = await readFile(join(right, 'docs', 'insulin-basics.mdx'), 'utf8');
      expect(a).toBe(b);
    } finally {
      await rm(left, { recursive: true, force: true });
      await rm(right, { recursive: true, force: true });
    }
  });

  it('preserves current medical review metadata and nested routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diarwiki-generated-review-'));
    try {
      const input = await json(inputUrl);
      input.materials[0].slug = 'treatment/insulin-basics';
      input.materials[0].blocks.push({
        id: '55555555-5555-4555-8555-555555555555',
        sort_order: 2,
        block_type: 'quick_answer',
        item: { content: '<p>Короткий ответ.</p>' },
      });
      const fingerprint = createSnapshot(input).content.materials[0].review_fingerprint;
      input.materials[0].medical_review_status = 'reviewed';
      input.materials[0].review_fingerprint = fingerprint;
      input.medical_reviews = [{
        material: input.materials[0].id,
        fingerprint,
        reviewer_name: 'Врач-рецензент',
        reviewer_specialty: 'Эндокринолог',
        reviewer_profile_url: 'https://example.org/doctor',
        decision: 'approved',
        reviewed_at: '2026-10-22T10:00:00Z',
        evidence_reference: 'review-evidence-42',
        owner_confirmed_by: 'owner-user-id',
        owner_confirmed_at: '2026-10-22T11:00:00Z',
      }];

      await generateContent(createSnapshot(input), root);
      const mdx = await readFile(join(root, 'docs', 'treatment', 'insulin-basics.mdx'), 'utf8');
      expect(mdx).toContain('medicalReview: "reviewed"');
      expect(mdx).toContain('reviewedBy: "Врач-рецензент"');
      expect(mdx).toContain(`reviewedContentHash: "${fingerprint}"`);
      expect(mdx).toContain("from '../../../components/articles/");
      const record = JSON.parse(await readFile(join(root, 'review-records', `${input.materials[0].content_id}.json`), 'utf8'));
      expect(record.evidenceRef).toBe('review-evidence-42');
      expect(record.approvedBy).toBe('site-owner');
      expect((await validateGeneratedContent(root)).problems).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sanitizes rich text and never accepts imports from CMS content', async () => {
    const rendered = renderBlocks(await json(maliciousUrl), { sources: [], media: [], related: [] });
    expect(rendered.body).toContain('Полезный текст');
    expect(rendered.body).not.toMatch(/<script|onclick|javascript:/iu);
    expect(rendered.body).not.toContain('import ');
  });

  it('sanitizes ordinary CMS page bodies before writing MDX', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diarwiki-generated-page-'));
    try {
      const input = await json(inputUrl);
      input.pages[0].body = '<p onmouseover="alert(1)">О проекте</p><script>alert(1)</script>\nimport Evil from "evil";\n{globalThis.alert(1)}\n[x](javascript:alert(1))';
      await generateContent(createSnapshot(input), root);
      const page = await readFile(join(root, 'docs', 'about.mdx'), 'utf8');
      expect(page).toContain('О проекте');
      expect(page).not.toMatch(/<script|onmouseover/iu);
      expect(page).not.toMatch(/^import Evil/gmu);
      expect(page).toContain('set:html={');
      expect((await validateGeneratedContent(root)).problems).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders every allowed structured block through known components and stable references', () => {
    const sha256 = 'a'.repeat(64);
    const rendered = renderBlocks([
      { id: '1', sort_order: 1, block_type: 'quick_answer', item: { title: 'Коротко', content: '<p>Ответ</p>' } },
      { id: '2', sort_order: 2, block_type: 'learning_list', item: { items: ['Пункт 1', 'Пункт 2'] } },
      { id: '3', sort_order: 3, block_type: 'article_step', item: { title: 'Шаг', step_number: 1, media: 'media-1', content: '<p>Описание</p>' } },
      { id: '4', sort_order: 4, block_type: 'medical_notice', item: { scope: 'emergency', title: 'Важно', content: '<p>Действие</p>' } },
      { id: '5', sort_order: 5, block_type: 'figure', item: { media: 'media-1', caption: 'Подпись' } },
      { id: '6', sort_order: 6, block_type: 'flow_diagram', item: { title: 'Схема', items: [{ label: 'Начало' }, { label: 'Конец', note: 'Пояснение' }] } },
      { id: '7', sort_order: 7, block_type: 'source_story', item: { source: 'source-1', content: '<p>Разбор</p>' } },
      { id: '8', sort_order: 8, block_type: 'sources', item: {} },
      { id: '9', sort_order: 9, block_type: 'next_material', item: { target: 'next-1' } },
      { id: '10', sort_order: 10, block_type: 'contact_prompt', item: { label: 'Написать', href: '/contact/' } },
    ], {
      sources: [{ source_id: 'source-1', title: 'Источник', url: 'https://example.org/source' }],
      media: [{ id: 'media-1', mime_type: 'image/webp', sha256, alt_text: 'Описание изображения' }],
      related: [{ content_id: 'next-1', slug: 'next/article', title: 'Следующий материал', description: 'Описание' }],
    });

    expect(rendered.imports).toEqual([
      'ArticleFigure', 'ArticleSources', 'ArticleStep', 'FlowDiagram', 'LearnList',
      'MedicalNotice', 'NextArticle', 'QuickAnswer', 'SourceStory',
    ]);
    expect(rendered.body).toContain(`/media/${sha256}.webp`);
    expect(rendered.body).toContain('href={"/next/article/"}');
    expect(rendered.body).toContain('href={"/contact/"}');
    expect(rendered.body).toContain('type={"urgent"}');
  });

  it('rejects unknown block types and unsafe contact URLs', () => {
    expect(() => renderBlocks([
      { id: 'x', sort_order: 1, block_type: 'raw_html', item: { content: '<b>x</b>' } },
    ], { sources: [], media: [], related: [] })).toThrow(/BLOCK_TYPE_UNSUPPORTED/u);
    expect(() => renderBlocks([
      { id: 'x', sort_order: 1, block_type: 'contact_prompt', item: { label: 'X', href: 'javascript:alert(1)' } },
    ], { sources: [], media: [], related: [] })).toThrow(/URL_NOT_ALLOWED/u);
  });
});
