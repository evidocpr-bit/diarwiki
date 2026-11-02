import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type LibraryCategoryId =
  | 'books'
  | 'research'
  | 'education'
  | 'apps'
  | 'communities'
  | 'quick-reads';

export interface LibraryCategory {
  id: LibraryCategoryId;
  label: string;
  shortLabel: string;
  description: string;
}

export interface LibraryResource {
  id: string;
  slug: string;
  title: string;
  resourceType: string;
  authors: string;
  publisher: string;
  year: string;
  language: string;
  format: string;
  pages: string;
  status: string;
  medicalReview: string;
  rights: string;
  accessUrl: string;
  accessLabel: string;
  authorsUrl: string;
  collectionUrl: string;
  telegramPostUrl: string;
  telegramAlternatives: Array<{ label: string; url: string }>;
  lastReviewed: string;
  category: LibraryCategory;
  topics: string[];
  summary: string;
  benefit: string;
  caution: string;
  featured: boolean;
  href: string;
}

export const libraryCategories: LibraryCategory[] = [
  {
    id: 'books',
    label: 'Книги и пособия',
    shortLabel: 'Книги',
    description: 'Пациентские книги, учебники и практические пособия. У старых изданий отдельно отмечено, что могло устареть.',
  },
  {
    id: 'research',
    label: 'Руководства и исследования',
    shortLabel: 'Исследования',
    description: 'Клинические темы, научные статьи и профессиональные материалы для проверки сложных утверждений.',
  },
  {
    id: 'education',
    label: 'Сайты, школы и видео',
    shortLabel: 'Сайты и школы',
    description: 'Обучающие платформы, лекции и видеоподборки. Подходят, когда удобнее смотреть и слушать, а не читать большую книгу.',
  },
  {
    id: 'apps',
    label: 'Приложения и сервисы',
    shortLabel: 'Приложения',
    description: 'Программы для датчиков, просмотра и передачи данных. Совместимость всегда зависит от модели сенсора, телефона и версии приложения.',
  },
  {
    id: 'communities',
    label: 'Инструкции и сообщества',
    shortLabel: 'Сообщества',
    description: 'Практический опыт пользователей: настройка, восстановление связи и типичные неполадки. Это не замена официальной инструкции.',
  },
  {
    id: 'quick-reads',
    label: 'Памятки и разборы',
    shortLabel: 'Памятки',
    description: 'Короткие материалы, которые помогают быстро сориентироваться в теме и понять, что стоит изучить глубже.',
  },
];

const categoryIds: Record<LibraryCategoryId, Set<string>> = {
  books: new Set([
    'LIB-001', 'LIB-002', 'LIB-003', 'LIB-004', 'LIB-005', 'LIB-006', 'LIB-007', 'LIB-008', 'LIB-009', 'LIB-010', 'LIB-011',
    'LIB-017', 'LIB-018', 'LIB-019', 'LIB-020', 'LIB-021', 'LIB-022', 'LIB-023', 'LIB-024', 'LIB-025',
  ]),
  research: new Set(['LIB-012', 'LIB-013', 'LIB-014', 'LIB-015', 'LIB-016', 'LIB-037', 'LIB-038', 'LIB-039', 'LIB-040']),
  education: new Set(['LIB-027', 'LIB-028', 'LIB-029', 'LIB-044']),
  apps: new Set(['LIB-031', 'LIB-032', 'LIB-033', 'LIB-034', 'LIB-043', 'LIB-046', 'LIB-047', 'LIB-048']),
  communities: new Set(['LIB-035', 'LIB-036', 'LIB-041', 'LIB-042', 'LIB-045', 'LIB-049']),
  'quick-reads': new Set(['LIB-026', 'LIB-030']),
};

const featuredIds = new Set(['LIB-001', 'LIB-002', 'LIB-027', 'LIB-030', 'LIB-033', 'LIB-041']);
const workspaceRoot = existsSync(resolve(process.cwd(), 'library/catalog.csv'))
  ? process.cwd()
  : resolve(process.cwd(), '..');

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      row.push(value);
      value = '';
      continue;
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
      continue;
    }
    value += character;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function categoryFor(id: string): LibraryCategory {
  const match = libraryCategories.find((category) => categoryIds[category.id].has(id));
  if (!match) throw new Error(`Library category is not defined for ${id}`);
  return match;
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/DiarWiki/gu, 'ДиарВики')
    .replace(/Для ДиарВики/gu, 'Для читателя')
    .replace(/для ДиарВики/gu, 'для читателя')
    .replace(/ДиарВики может/gu, 'Из этого можно')
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/^\s*\|.*\|\s*$/gmu, '')
    .replace(/[*_`>#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sectionText(markdown: string, headings: string[]): string {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  for (const heading of headings) {
    const start = lines.findIndex((line) => line.trim().toLocaleLowerCase('ru') === `## ${heading}`.toLocaleLowerCase('ru'));
    if (start < 0) continue;
    const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/u.test(line));
    const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
    const cleaned = cleanMarkdown(lines.slice(start + 1, end).join('\n'));
    if (cleaned) return cleaned;
  }
  return '';
}

function truncate(value: string, limit = 430): string {
  if (value.length <= limit) return value;
  const shortened = value.slice(0, limit + 1).replace(/\s+\S*$/u, '').trim();
  return `${shortened}…`;
}

function resourceTopics(title: string, type: string): string[] {
  const text = `${title} ${type}`.toLocaleLowerCase('ru');
  const topics: string[] = [];
  if (/помп|инфуз/u.test(text)) topics.push('Помпы');
  if (/беремен|women|pregnancy/u.test(text)) topics.push('Беременность');
  if (/монитор|cgm|датчик|sibionics|hematonix|juggluco|xdrip|diabox|nightscout|ottai|syai/u.test(text)) topics.push('Датчики и CGM');
  if (/глюкометр|точност/u.test(text)) topics.push('Глюкометры');
  if (/спорт/u.test(text)) topics.push('Спорт');
  if (/почки/u.test(text)) topics.push('Почки');
  if (/зрение/u.test(text)) topics.push('Зрение');
  if (/психосомат|стресс/u.test(text)) topics.push('Психология');
  if (/генетик/u.test(text)) topics.push('Генетика');
  if (/инъекц/u.test(text)) topics.push('Инъекции');
  if (/вариабель|статистик/u.test(text)) topics.push('Показатели глюкозы');
  if (/детей|подрост/u.test(text)) topics.push('Дети и подростки');
  if (topics.length === 0) topics.push('Жизнь с диабетом');
  return topics.slice(0, 3);
}

function publicText(markdown: string, kind: 'summary' | 'benefit' | 'caution'): string {
  const headings = {
    summary: [
      'Краткое описание для сайта', 'Короткое описание для сайта', 'Короткая версия для сайта', 'Краткое описание',
      'Что это за ресурс', 'Что это', 'Что находится в канале', 'Состав подборки', 'Редакционное заключение',
    ],
    benefit: [
      'Что даёт пользователю', 'Что даёт ресурс', 'Что даёт книга', 'Что даёт пособие', 'Что в подборке полезно',
      'Почему канал полезен', 'Что можно взять для DiarWiki', 'Что можно использовать на DiarWiki', 'Что можно превратить в статьи',
    ],
    caution: [
      'Ограничения', 'Ограничения источника', 'Ограничения ресурса', 'Ограничения и риски', 'Ограничения и риск',
      'Главное ограничение', 'Что требует осторожности', 'Что не подтверждено', 'Главный риск', 'Красные флаги',
      'Что нельзя переносить напрямую', 'Что нельзя переносить как обычную рекомендацию', 'Правило безопасности',
    ],
  } as const;
  return sectionText(markdown, [...headings[kind]]);
}

function slugFromCardPath(cardPath: string): string {
  const fileName = cardPath.replace(/\\/gu, '/').split('/').at(-1) ?? '';
  return fileName.replace(/^\d+_/u, '').replace(/\.md$/u, '').replace(/_/gu, '-');
}

function accessLabel(url: string): string {
  if (/apps\.apple\.com/u.test(url)) return 'Открыть в App Store';
  if (/play\.google\.com/u.test(url)) return 'Открыть в Google Play';
  if (/github\.com/u.test(url)) return 'Открыть проект на GitHub';
  if (/t\.me/u.test(url)) return 'Открыть в Telegram';
  if (/medlib|uptodate|dynamed/u.test(url)) return 'Открыть клинический ресурс';
  return 'Открыть источник';
}

let cachedResources: LibraryResource[] | undefined;

function generatedCmsResources(): LibraryResource[] | undefined {
  const path = resolve(process.cwd(), 'src/generated-cms-data/library.json');
  if (!existsSync(path)) return undefined;
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const category = libraryCategories.find(({ id }) => id === row.category);
    if (!category) throw new Error(`CMS library category is not defined for ${String(row.library_id)}`);
    const accessUrl = String(row.public_url ?? '');
    return {
      id: String(row.library_id),
      slug: String(row.slug),
      title: String(row.title),
      resourceType: String(row.resource_type),
      authors: String(row.author_or_organization ?? ''),
      publisher: String(row.publisher ?? ''),
      year: String(row.source_year ?? ''),
      language: String(row.language ?? ''),
      format: String(row.format ?? ''),
      pages: String(row.pages ?? ''),
      status: String(row.editorial_status ?? ''),
      medicalReview: String(row.medical_review_status ?? 'pending'),
      rights: String(row.rights_note ?? ''),
      accessUrl,
      accessLabel: String(row.access_label ?? accessLabel(accessUrl)),
      authorsUrl: String(row.alternative_url ?? ''),
      collectionUrl: '',
      telegramPostUrl: '',
      telegramAlternatives: Array.isArray(row.additional_links)
        ? row.additional_links.filter((link): link is { label: string; url: string } => Boolean(link && typeof link === 'object' && 'label' in link && 'url' in link))
        : [],
      lastReviewed: String(row.last_checked_at ?? ''),
      category,
      topics: Array.isArray(row.topics) ? row.topics.map(String) : [],
      summary: String(row.description),
      benefit: String(row.benefit ?? row.description),
      caution: String(row.caution ?? ''),
      featured: row.featured === true,
      href: `/library/${String(row.slug)}/`,
    } satisfies LibraryResource;
  });
}

export function getLibraryResources(): LibraryResource[] {
  if (cachedResources) return cachedResources;
  const generated = generatedCmsResources();
  if (generated) {
    cachedResources = generated;
    return cachedResources;
  }

  const rows = parseCsv(readFileSync(resolve(workspaceRoot, 'library/catalog.csv'), 'utf8'));
  const headers = rows.shift() ?? [];
  cachedResources = rows.map((values) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as Record<string, string>;
    const markdown = readFileSync(resolve(workspaceRoot, row.card_path), 'utf8');
    const slug = slugFromCardPath(row.card_path);
    const category = categoryFor(row.id);
    const isBookOrPublication = category.id === 'books';
    const linkPolicy = row.public_link_status;
    const blockTelegramDistribution = linkPolicy === 'rights_pending' || linkPolicy === 'admin_consent_pending';
    const isTelegram = (url: string) => /^https:\/\/t\.me\//u.test(url);
    const catalogAccessUrl = row.access_url && !((isBookOrPublication || blockTelegramDistribution) && isTelegram(row.access_url))
      ? row.access_url
      : '';
    const accessUrl = catalogAccessUrl || (isBookOrPublication || blockTelegramDistribution
      ? row.authors_url
      : row.telegram_post_url || row.collection_url || row.authors_url);
    const telegramAlternatives = (isBookOrPublication || blockTelegramDistribution ? [] : [
      row.telegram_post_url && { label: 'Публикация в Telegram', url: row.telegram_post_url },
      isTelegram(row.collection_url) && { label: 'Канал или сообщество в Telegram', url: row.collection_url },
    ])
      .filter((item): item is { label: string; url: string } => Boolean(item))
      .filter((item, index, items) => item.url !== accessUrl && items.findIndex((candidate) => candidate.url === item.url) === index);
    const summary = publicText(markdown, 'summary') || `${row.resource_type}. ${row.authors_or_organization}.`;
    const benefit = publicText(markdown, 'benefit') || summary;
    const caution = publicText(markdown, 'caution') || row.medical_review;

    return {
      id: row.id,
      slug,
      title: row.title,
      resourceType: row.resource_type,
      authors: row.authors_or_organization,
      publisher: row.publisher,
      year: row.source_year,
      language: row.language,
      format: row.format,
      pages: row.pages,
      status: row.status,
      medicalReview: row.medical_review,
      rights: blockTelegramDistribution
        ? `${row.rights} ${linkPolicy === 'admin_consent_pending'
          ? 'Ссылка на группу будет добавлена после согласования с её администраторами.'
          : 'Ссылка на публикацию будет добавлена после согласования с правообладателем.'}`
        : row.rights,
      accessUrl,
      accessLabel: accessLabel(accessUrl),
      authorsUrl: row.authors_url,
      collectionUrl: isBookOrPublication && isTelegram(row.collection_url) ? '' : row.collection_url,
      telegramPostUrl: isBookOrPublication || blockTelegramDistribution ? '' : row.telegram_post_url,
      telegramAlternatives,
      lastReviewed: row.last_reviewed,
      category,
      topics: resourceTopics(row.title, row.resource_type),
      summary: truncate(summary),
      benefit: truncate(benefit, 700),
      caution: truncate(caution, 700),
      featured: featuredIds.has(row.id),
      href: `/library/${slug}/`,
    } satisfies LibraryResource;
  });

  if (cachedResources.length !== 49) throw new Error(`Expected 49 library resources, got ${cachedResources.length}`);
  return cachedResources;
}

export function formatReviewDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('ru-RU').format(new Date(Date.UTC(year, month - 1, day)));
}
