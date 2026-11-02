import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const telegramCategoryOrder = [
  'Библиотека',
  'Общение',
  'Блоги',
  'Мониторинги',
  'Помпы',
  'Системы APS',
  'Куплю, обменяю, продам',
  'Льготы',
  'Региональные сообщества',
] as const;

export type TelegramCategory = (typeof telegramCategoryOrder)[number];

export interface TelegramCommunity {
  id: string;
  slug: string;
  name: string;
  category: TelegramCategory;
  url: string;
  access: string;
  audience: string;
  region: string;
  description: string;
  editorialNote: string;
  canLink: boolean;
}

const workspaceRoot = existsSync(resolve(process.cwd(), 'library/community_telegram/channels.tsv'))
  ? process.cwd()
  : resolve(process.cwd(), '..');

let cachedCommunities: TelegramCommunity[] | undefined;

export function getTelegramCommunities(): TelegramCommunity[] {
  if (cachedCommunities) return cachedCommunities;

  const source = readFileSync(resolve(workspaceRoot, 'library/community_telegram/channels.tsv'), 'utf8')
    .replace(/^\uFEFF/u, '')
    .trim();
  const [headerLine, ...lines] = source.split(/\r?\n/u);
  const headers = headerLine.split('\t');

  cachedCommunities = lines.filter(Boolean).map((line) => {
    const values = line.split('\t');
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as Record<string, string>;
    if (!telegramCategoryOrder.includes(row.category as TelegramCategory)) {
      throw new Error(`Unknown Telegram category for ${row.id}: ${row.category}`);
    }
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category as TelegramCategory,
      url: row.url,
      access: row.access,
      audience: row.audience,
      region: row.region,
      description: row.description,
      editorialNote: row.editorial_note.replace(/DiarWiki/gu, 'ДиарВики'),
      canLink: Boolean(row.url) && row.id !== 'TG-006',
    } satisfies TelegramCommunity;
  });

  if (cachedCommunities.length !== 95) {
    throw new Error(`Expected 95 Telegram resources, got ${cachedCommunities.length}`);
  }
  return cachedCommunities;
}

export function getTelegramCategoryCounts(): Array<{ category: TelegramCategory; count: number }> {
  const communities = getTelegramCommunities();
  return telegramCategoryOrder.map((category) => ({
    category,
    count: communities.filter((community) => community.category === category).length,
  }));
}
