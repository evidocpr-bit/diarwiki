import { getCollection, type CollectionEntry } from 'astro:content';
import type { ContentRepository, ContentSummary, ContentType } from './types';

type DocEntry = CollectionEntry<'docs'>;

function hrefFor(entry: DocEntry): string {
  const slug = entry.id.replace(/\/index$/, '');
  return `/${slug}/`.replace(/\/+/g, '/');
}

function toSummary(entry: DocEntry): ContentSummary {
  return {
    id: entry.data.contentId,
    order: entry.data.order ?? null,
    slug: entry.id,
    href: hrefFor(entry),
    title: entry.data.title,
    summary: entry.data.summary,
    type: entry.data.contentType,
    status: entry.data.status,
    medicalReview: entry.data.medicalReview,
    reviewedBy: entry.data.reviewedBy,
    reviewerSpecialty: entry.data.reviewerSpecialty,
    reviewedAt: entry.data.reviewedAt,
    audience: entry.data.audience,
    topics: entry.data.topics,
    updatedAt: entry.data.updatedAt,
    sourceIds: entry.data.sourceIds,
    relatedIds: entry.data.relatedIds,
  };
}

async function allPublished(): Promise<ContentSummary[]> {
  const entries = await getCollection('docs', ({ data }) =>
    (data.status === 'ready' || data.status === 'published') && data.draft !== true,
  );

  const seenIds = new Set<string>();
  const seenHrefs = new Set<string>();
  const result = entries.map(toSummary);

  for (const item of result) {
    if (seenIds.has(item.id)) throw new Error(`Duplicate content id: ${item.id}`);
    if (seenHrefs.has(item.href)) throw new Error(`Duplicate content URL: ${item.href}`);
    seenIds.add(item.id);
    seenHrefs.add(item.href);
  }

  return result.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'ru'));
}

export const astroContentRepository: ContentRepository = {
  async listPublished(type?: ContentType) {
    const items = await allPublished();
    return type ? items.filter((item) => item.type === type) : items;
  },
  async findBySlug(slug: string) {
    return (await allPublished()).find((item) => item.slug === slug);
  },
  async findById(id: string) {
    return (await allPublished()).find((item) => item.id === id);
  },
  async relatedTo(id: string) {
    const items = await allPublished();
    const current = items.find((item) => item.id === id);
    if (!current) return [];
    return current.relatedIds
      .map((relatedId) => items.find((item) => item.id === relatedId))
      .filter((item): item is ContentSummary => Boolean(item));
  },
};
