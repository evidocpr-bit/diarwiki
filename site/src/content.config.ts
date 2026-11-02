import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

const contentFields = z.object({
  schemaVersion: z.literal(1).default(1),
  contentId: z.string().min(3),
  order: z.number().int().positive().optional(),
  contentType: z.enum(['article', 'pathway', 'glossary', 'page']).default('page'),
  summary: z.string().min(20),
  status: z.enum(['draft', 'ready', 'published', 'archived']).default('draft'),
  audience: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  medicalReview: z.enum(['pending', 'reviewed', 'revision_required']).default('pending'),
  reviewedBy: z.string().nullable().default(null),
  reviewerSpecialty: z.string().nullable().default(null),
  reviewerProfileUrl: z.url().nullable().default(null),
  reviewedAt: z.coerce.date().nullable().default(null),
  reviewedContentHash: z.string().regex(/^[a-f\d]{64}$/iu).nullable().default(null),
  publishedAt: z.coerce.date().nullable().default(null),
  updatedAt: z.coerce.date(),
  sourceIds: z.array(z.string()).default([]),
  relatedIds: z.array(z.string()).default([]),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  articleFormat: z.enum(['guide', 'explainer', 'reference']).default('reference'),
  level: z.enum(['basic', 'practical', 'advanced']).default('basic'),
  disclaimerScope: z.enum(['standard', 'device', 'treatment', 'emergency']).default('standard'),
}).superRefine((content, context) => {
  const reviewDetails = [content.reviewedBy, content.reviewerSpecialty, content.reviewedAt, content.reviewedContentHash];
  if (content.medicalReview === 'reviewed' && reviewDetails.some((value) => value === null)) {
    context.addIssue({ code: 'custom', message: 'A reviewed item must identify its reviewer, specialty, review date, and reviewed content hash.' });
  }
  if (content.medicalReview !== 'reviewed' && reviewDetails.some((value) => value !== null)) {
    context.addIssue({ code: 'custom', message: 'Reviewer details must be cleared when an item is not currently reviewed.' });
  }
  if (content.status === 'published' && content.risk === 'high' && content.medicalReview !== 'reviewed') {
    context.addIssue({ code: 'custom', message: 'High-risk published content requires a current medical review.' });
  }
});

const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema({ extend: contentFields }),
});

const i18n = defineCollection({
  loader: i18nLoader(),
  schema: i18nSchema(),
});

const sources = defineCollection({
  loader: glob({ base: './src/content/sources', pattern: '**/*.json' }),
  schema: z.object({
    id: z.string().min(3),
    title: z.string().min(3),
    organization: z.string().min(2),
    url: z.url(),
    language: z.enum(['ru', 'en']),
    accessedAt: z.coerce.date(),
    note: z.string().optional(),
  }),
});

export const collections = { docs, i18n, sources };
