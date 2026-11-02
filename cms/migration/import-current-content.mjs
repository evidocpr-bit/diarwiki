import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { importLibrary } from './import-library.mjs';
import { importPages } from './import-pages.mjs';
import { deterministicUuid, parseMdxDocument } from './parse-mdx.mjs';
import { createMigrationReport } from './report.mjs';

const BLOCK_TYPE_BY_COLLECTION = {
  block_rich_text: 'rich_text', block_quick_answer: 'quick_answer',
  block_learning_list: 'learning_list', block_article_step: 'article_step',
  block_medical_notice: 'medical_notice', block_figure: 'figure',
  block_flow_diagram: 'flow_diagram', block_source_story: 'source_story',
  block_sources: 'sources', block_next_material: 'next_material',
  block_contact_prompt: 'contact_prompt',
};

const MIME_BY_EXTENSION = {
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.pdf': 'application/pdf',
};

async function filesRecursively(root, extension) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (!extension || entry.name.endsWith(extension)) result.push(path);
    }
  }
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right, 'en'));
}

function webpDimensions(buffer) {
  const kind = buffer.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X' && buffer.length >= 30) {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (kind === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (kind === 'VP8 ' && buffer.length >= 30) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return {};
}

function mediaDimensions(buffer, mimeType) {
  if (mimeType === 'image/webp') return webpDimensions(buffer);
  if (mimeType === 'image/png' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (mimeType === 'image/svg+xml') {
    const source = buffer.toString('utf8');
    const width = Number(source.match(/\bwidth=["']([\d.]+)/iu)?.[1]);
    const height = Number(source.match(/\bheight=["']([\d.]+)/iu)?.[1]);
    if (width && height) return { width, height };
    const viewBox = source.match(/\bviewBox=["'][\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)["']/iu);
    return viewBox ? { width: Number(viewBox[1]), height: Number(viewBox[2]) } : {};
  }
  return {};
}

function articleRoute(slug) {
  return `/${String(slug).replace(/^\/+|\/+$/gu, '')}/`;
}

function materialRecord(frontmatter, slug) {
  const reviewed = frontmatter.medicalReview === 'reviewed'
    && frontmatter.reviewedBy && frontmatter.reviewerSpecialty
    && frontmatter.reviewedAt && frontmatter.reviewedContentHash;
  return {
    id: deterministicUuid(`material:${frontmatter.contentId}`),
    content_id: frontmatter.contentId,
    slug,
    content_type: frontmatter.contentType ?? 'article',
    title: frontmatter.title,
    description: frontmatter.description,
    summary: frontmatter.summary,
    workflow_status: 'ready_to_publish',
    medical_review_status: reviewed ? 'reviewed' : 'pending',
    risk: frontmatter.risk ?? 'low',
    article_format: frontmatter.articleFormat ?? 'reference',
    level: frontmatter.level ?? 'basic',
    disclaimer_scope: frontmatter.disclaimerScope ?? 'standard',
    sort_order: frontmatter.order ?? null,
    audiences: frontmatter.audience ?? [],
    topics: frontmatter.topics ?? [],
    table_of_contents: frontmatter.tableOfContents ?? true,
    review_fingerprint: reviewed ? frontmatter.reviewedContentHash : null,
    published_at: frontmatter.publishedAt ?? null,
    public_updated_at: frontmatter.updatedAt ?? frontmatter.lastUpdated ?? null,
  };
}

function sourceRecord(source) {
  return {
    id: deterministicUuid(`source:${source.id}`),
    source_id: source.id,
    title: source.title,
    author_or_organization: source.organization,
    url: source.url ?? null,
    doi: source.doi ?? null,
    bibliographic_description: source.note ?? null,
    language: source.language ?? 'ru',
    source_type: source.sourceType ?? 'reference',
    accessed_at: String(source.accessedAt).slice(0, 10),
  };
}

function noticeScope(type) {
  return { important: 'standard', doctor: 'treatment', device: 'device', urgent: 'emergency' }[type] ?? 'standard';
}

function contentIdFromHref(href, routeMap) {
  return routeMap.get(new URL(href, 'https://diarwiki.invalid').pathname)?.content_id;
}

export async function createMigrationBundle(workspaceRoot, options = {}) {
  const siteRoot = join(workspaceRoot, 'site');
  const docsRoot = join(siteRoot, 'src', 'content', 'docs');
  const sourcesRoot = join(siteRoot, 'src', 'content', 'sources');
  const siteConfig = await import(pathToFileURL(join(siteRoot, 'src', 'config', 'site.ts')).href);
  const mediaAudit = await import(pathToFileURL(join(workspaceRoot, 'cms', 'extensions', 'diarwiki-media', 'src', 'validate-upload.ts')).href);

  const parsedDocuments = [];
  for (const path of await filesRecursively(docsRoot, '.mdx')) {
    const parsed = parseMdxDocument(await readFile(path, 'utf8'));
    const slug = relative(docsRoot, path).replaceAll('\\', '/').replace(/\.mdx$/u, '');
    parsedDocuments.push({ path, slug, ...parsed });
  }

  const materials = parsedDocuments.map(({ frontmatter, slug }) => materialRecord(frontmatter, slug));
  const materialByContentId = new Map(materials.map((material) => [material.content_id, material]));
  const materialByRoute = new Map(materials.map((material) => [articleRoute(material.slug), material]));

  const sources = [];
  for (const path of await filesRecursively(sourcesRoot, '.json')) {
    sources.push(sourceRecord(JSON.parse(await readFile(path, 'utf8'))));
  }
  const sourceById = new Map(sources.map((source) => [source.source_id, source]));
  const sourceByUrl = new Map(sources.filter((source) => source.url).map((source) => [source.url, source]));
  const ensureSource = (input) => {
    const url = input.url ?? input.href ?? null;
    if (url && sourceByUrl.has(url)) return sourceByUrl.get(url);
    const sourceId = input.id ?? `inline-${createHash('sha256').update(`${input.title}|${url ?? ''}`).digest('hex').slice(0, 16)}`;
    if (sourceById.has(sourceId)) return sourceById.get(sourceId);
    const record = {
      id: deterministicUuid(`source:${sourceId}`), source_id: sourceId,
      title: input.title, author_or_organization: input.organization ?? input.kind ?? 'Источник материала',
      url, doi: null, bibliographic_description: input.note ?? input.caution ?? null,
      language: input.language ?? 'ru', source_type: input.source_type ?? 'reference',
      accessed_at: options.accessedAt ?? '2026-10-22',
    };
    sources.push(record); sourceById.set(sourceId, record);
    if (url) sourceByUrl.set(url, record);
    return record;
  };

  const collections = {
    materials,
    material_blocks: [], material_sources: [], material_relations: [],
    block_rich_text: [], block_quick_answer: [], block_learning_list: [],
    block_article_step: [], block_medical_notice: [], block_figure: [],
    block_flow_diagram: [], block_source_story: [], block_sources: [],
    block_next_material: [], block_contact_prompt: [],
    sources, library_items: [], pages: [], navigation: [], site_settings: [], media_metadata: [],
  };
  const mediaFiles = [];
  const mediaBySource = new Map();
  const registerMedia = async (src, altText, caption) => {
    if (mediaBySource.has(src)) return mediaBySource.get(src);
    if (!src.startsWith('/')) throw new Error(`MEDIA_SOURCE_NOT_LOCAL: ${src}`);
    const path = resolve(siteRoot, 'public', src.slice(1));
    const publicRoot = resolve(siteRoot, 'public');
    if (!path.startsWith(publicRoot)) throw new Error(`MEDIA_PATH_ESCAPE: ${src}`);
    const buffer = await readFile(path);
    const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
    if (!mimeType) throw new Error(`MEDIA_MIME_UNSUPPORTED: ${src}`);
    const dimensions = mediaDimensions(buffer, mimeType);
    const input = {
      filename: path.split(/[\\/]/u).at(-1), mimeType, byteSize: buffer.length,
      ...dimensions, altText, authorOrSource: 'Редакция ДиарВики',
      rightsBasis: 'Используется на действующем сайте; основание прав требуется подтвердить перед первым выпуском из CMS.',
    };
    const audit = mediaAudit.auditMediaBuffer(buffer, input);
    const id = deterministicUuid(`media:${src}`);
    const record = {
      id, sha256: audit.sha256, mime_type: mimeType, byte_size: buffer.length,
      width: dimensions.width ?? null, height: dimensions.height ?? null,
      alt_text: altText, caption: caption ?? null, author_or_source: input.authorOrSource,
      rights_basis: input.rightsBasis, rights_status: 'pending',
      security_status: audit.problems.length === 0 ? 'passed' : 'failed',
      security_checked_at: new Date().toISOString(), security_findings: audit.problems,
    };
    collections.media_metadata.push(record);
    mediaFiles.push({ media_id: id, source_path: relative(workspaceRoot, path).replaceAll('\\', '/'), filename: input.filename });
    mediaBySource.set(src, record);
    return record;
  };

  const sourceLinksByMaterial = new Map();
  const addSourceLink = (material, source, note = null) => {
    const key = `${material.id}:${source.id}`;
    const links = sourceLinksByMaterial.get(material.id) ?? new Set();
    if (links.has(key)) return;
    links.add(key); sourceLinksByMaterial.set(material.id, links);
    collections.material_sources.push({
      id: deterministicUuid(`material-source:${material.content_id}:${source.source_id}`),
      material: material.id, source: source.id, sort_order: links.size, note,
    });
  };

  const addBlock = (material, index, collection, item) => {
    const itemId = deterministicUuid(`block-item:${material.content_id}:${index}:${collection}`);
    const blockId = deterministicUuid(`block:${material.content_id}:${index}`);
    const itemRecord = { id: itemId, material: material.id, ...item };
    collections[collection].push(itemRecord);
    collections.material_blocks.push({
      id: blockId, material: material.id, sort_order: index,
      block_type: BLOCK_TYPE_BY_COLLECTION[collection],
      item: { collection, item: itemId },
    });
    return itemRecord;
  };

  const deferredNext = [];
  for (const document of parsedDocuments) {
    const material = materialByContentId.get(document.frontmatter.contentId);
    for (const sourceId of document.frontmatter.sourceIds ?? []) {
      const source = sourceById.get(sourceId);
      if (!source) throw new Error(`MATERIAL_SOURCE_MISSING: ${material.content_id}:${sourceId}`);
      addSourceLink(material, source);
    }
    for (const relatedId of document.frontmatter.relatedIds ?? []) {
      const target = materialByContentId.get(relatedId);
      if (!target) throw new Error(`RELATED_MATERIAL_MISSING: ${material.content_id}:${relatedId}`);
      collections.material_relations.push({
        id: deterministicUuid(`material-relation:${material.content_id}:${relatedId}`),
        material: material.id, related_material: target.id,
        sort_order: collections.material_relations.filter((entry) => entry.material === material.id).length + 1,
      });
    }

    let blockOrder = 0;
    for (const token of document.tokens) {
      blockOrder += 1;
      if (token.kind === 'markdown') {
        const contact = token.markdown.match(/^\[([^\]]+)\]\((\/contact\/)\)\.?$/u);
        if (contact) addBlock(material, blockOrder, 'block_contact_prompt', { label: contact[1], href: contact[2] });
        else addBlock(material, blockOrder, 'block_rich_text', { content: token.html });
        continue;
      }
      const attributes = token.attributes;
      if (token.name === 'QuickAnswer') {
        addBlock(material, blockOrder, 'block_quick_answer', { title: attributes.title ?? null, content: token.html });
      } else if (token.name === 'LearnList') {
        addBlock(material, blockOrder, 'block_learning_list', { items: attributes.items });
      } else if (token.name === 'ArticleStep') {
        const media = await registerMedia(attributes.image, attributes.imageAlt, attributes.caption);
        addBlock(material, blockOrder, 'block_article_step', {
          step_number: attributes.number, title: attributes.title, content: token.html,
          media: media.id, caption: attributes.caption ?? null, reverse: attributes.reverse ?? false,
        });
      } else if (token.name === 'MedicalNotice') {
        addBlock(material, blockOrder, 'block_medical_notice', {
          scope: noticeScope(attributes.type), title: attributes.title ?? null, content: token.html,
        });
      } else if (token.name === 'ArticleFigure') {
        const media = await registerMedia(attributes.src, attributes.alt, attributes.caption);
        addBlock(material, blockOrder, 'block_figure', { media: media.id, caption: attributes.caption ?? null });
      } else if (token.name === 'FlowDiagram') {
        addBlock(material, blockOrder, 'block_flow_diagram', { title: attributes.title, items: attributes.items });
      } else if (token.name === 'SourceStory') {
        const source = ensureSource({ title: attributes.title, url: attributes.href, kind: attributes.kind, caution: attributes.caution });
        addSourceLink(material, source);
        addBlock(material, blockOrder, 'block_source_story', {
          source: source.id, title_override: attributes.title ?? null, kind: attributes.kind ?? null,
          caution: attributes.caution ?? null, content: token.html,
        });
      } else if (token.name === 'ArticleSources') {
        for (const embedded of attributes.sources ?? []) {
          const source = ensureSource(embedded);
          addSourceLink(material, source, embedded.note ?? null);
        }
        addBlock(material, blockOrder, 'block_sources', { title: 'Источники', include_all_material_sources: true });
      } else if (token.name === 'NextArticle') {
        const item = { target: null, description_override: attributes.description ?? null };
        const itemRecord = addBlock(material, blockOrder, 'block_next_material', item);
        deferredNext.push({ item: itemRecord, material, href: attributes.href });
      }
    }
  }

  for (const link of deferredNext) {
    const targetId = contentIdFromHref(link.href, materialByRoute);
    const target = targetId && materialByContentId.get(targetId);
    if (!target) throw new Error(`NEXT_MATERIAL_MISSING: ${link.material.content_id}:${link.href}`);
    link.item.target = target.id;
  }

  collections.sources.sort((left, right) => left.source_id.localeCompare(right.source_id, 'en'));
  collections.library_items = await importLibrary(workspaceRoot);
  const pageImport = await importPages(workspaceRoot);
  collections.pages = pageImport.pages.map(({ source_file: _sourceFile, ...page }) => page);

  let navigationOrder = 0;
  for (const route of siteConfig.siteRoutes) {
    for (const placement of route.placements) {
      navigationOrder += 1;
      collections.navigation.push({
        id: deterministicUuid(`navigation:${placement}:${route.href}`), label: route.label,
        href: route.href, placement, sort_order: navigationOrder, parent: null, enabled: true,
      });
    }
  }
  let sidebarOrder = 0;
  for (const entry of siteConfig.sidebarNavigation) {
    sidebarOrder += 1;
    if ('items' in entry) {
      const parentId = deterministicUuid(`navigation:sidebar-group:${entry.label}`);
      collections.navigation.push({ id: parentId, label: entry.label, href: '', placement: 'sidebar', sort_order: sidebarOrder, parent: null, enabled: true });
      let childOrder = 0;
      for (const child of entry.items) {
        childOrder += 1;
        collections.navigation.push({
          id: deterministicUuid(`navigation:sidebar:${child.link}`), label: child.label, href: child.link,
          placement: 'sidebar', sort_order: childOrder, parent: parentId, enabled: true,
        });
      }
    } else {
      collections.navigation.push({
        id: deterministicUuid(`navigation:sidebar:${entry.link}`), label: entry.label, href: entry.link,
        placement: 'sidebar', sort_order: sidebarOrder, parent: null, enabled: true,
      });
    }
  }

  const identity = siteConfig.siteIdentity;
  collections.site_settings = [{
    id: deterministicUuid('site-settings:primary'), project_name: identity.name,
    canonical_origin: identity.origin, editor_email: identity.editorEmail,
    owner_name: identity.owner.name, owner_status: identity.owner.status,
    owner_location: identity.owner.location, partner_name: identity.evidoc.name,
    partner_url: identity.evidoc.url, mission: identity.mission,
    medical_review_required_risks: ['high'],
  }];

  return {
    schema_version: 1,
    source_commit: options.sourceCommit ?? 'working-tree',
    generated_at: new Date().toISOString(),
    collections,
    media_files: mediaFiles,
    provenance: {
      documents: parsedDocuments.map(({ path, frontmatter }) => ({
        source_file: relative(workspaceRoot, path).replaceAll('\\', '/'), content_id: frontmatter.contentId,
      })),
      pages: pageImport.pages.map(({ source_file, page_id }) => ({ source_file, page_id })),
      code_managed_pages: pageImport.skipped,
    },
  };
}

function parseArguments(argv) {
  const options = { workspace: process.cwd(), output: join(process.cwd(), 'working', 'cms_migration') };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--workspace') options.workspace = resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = resolve(argv[++index]);
    else if (argv[index] === '--source-commit') options.sourceCommit = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await mkdir(options.output, { recursive: true });
  const bundle = await createMigrationBundle(options.workspace, options);
  const report = createMigrationReport(bundle);
  await writeFile(join(options.output, 'migration-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  await writeFile(join(options.output, 'migration-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(options.output, 'migration-report.md'), report.markdown, 'utf8');
  console.log(`Подготовлено материалов: ${bundle.collections.materials.length}; страниц: ${bundle.collections.pages.length}; ресурсов библиотеки: ${bundle.collections.library_items.length}.`);
  console.log(`Отчёт: ${join(options.output, 'migration-report.md')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
