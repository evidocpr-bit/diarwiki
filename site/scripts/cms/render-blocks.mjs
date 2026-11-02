import sanitizeHtml from 'sanitize-html';

const COMPONENTS = new Set([
  'ArticleFigure',
  'ArticleSources',
  'ArticleStep',
  'FlowDiagram',
  'LearnList',
  'MedicalNotice',
  'NextArticle',
  'QuickAnswer',
  'SourceStory',
]);

const MIME_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

export class BlockRenderError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'BlockRenderError';
    this.code = code;
  }
}

function js(value) {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BlockRenderError('BLOCK_FIELD_REQUIRED', `Не заполнено поле ${field}.`);
  }
  return value.trim();
}

export function safeUrl(value, { external = true } = {}) {
  const url = text(value, 'url');
  if (/[\u0000-\u001f\u007f\\]/u.test(url)) {
    throw new BlockRenderError('URL_NOT_ALLOWED', 'Недопустимые символы в URL.');
  }
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (url.startsWith('mailto:') && !/[\s<>]/u.test(url)) return url;
  if (external) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') return parsed.href;
    } catch { /* fall through */ }
  }
  throw new BlockRenderError('URL_NOT_ALLOWED', `URL ${url} не разрешён.`);
}

export function sanitizeRichText(value) {
  const sanitized = sanitizeHtml(String(value ?? ''), {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'h2', 'h3', 'h4',
      'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a(tagName, attributes) {
        try {
          const href = safeUrl(attributes.href ?? '', { external: true });
          return { tagName, attribs: { href, ...(attributes.title ? { title: attributes.title } : {}) } };
        } catch {
          return { tagName: 'span', attribs: {} };
        }
      },
    },
  }).trim();
  if (!sanitized) return '';
  return `<div class="cms-rich-text" set:html={${js(sanitized)}} />`;
}

function mediaSource(media) {
  if (!media) throw new BlockRenderError('MEDIA_NOT_FOUND', 'Блок ссылается на отсутствующее медиа.');
  const extension = MIME_EXTENSION[media.mime_type];
  if (!extension || !/^[a-f\d]{64}$/u.test(media.sha256 ?? '')) {
    throw new BlockRenderError('MEDIA_NOT_READY', 'Медиа не имеет разрешённого типа или SHA-256.');
  }
  return `/media/${media.sha256}${extension}`;
}

function byReference(items, reference, keys = ['id']) {
  const value = typeof reference === 'object' ? reference?.id ?? reference?.content_id ?? reference?.source_id : reference;
  return items.find((item) => keys.some((key) => item[key] === value));
}

export function renderBlocks(blocks, context = {}) {
  const imports = new Set();
  const rendered = [];
  const sources = context.sources ?? [];
  const media = context.media ?? [];
  const related = context.related ?? [];

  const use = (name) => {
    if (!COMPONENTS.has(name)) throw new BlockRenderError('COMPONENT_NOT_ALLOWED', name);
    imports.add(name);
  };

  for (const block of [...blocks].sort((a, b) => Number(a.sort_order) - Number(b.sort_order))) {
    const item = block.item ?? {};
    switch (block.block_type) {
      case 'rich_text':
        rendered.push(sanitizeRichText(item.content));
        break;
      case 'quick_answer':
        use('QuickAnswer');
        rendered.push(`<QuickAnswer${item.title ? ` title={${js(item.title)}}` : ''}>\n${sanitizeRichText(item.content)}\n</QuickAnswer>`);
        break;
      case 'learning_list': {
        use('LearnList');
        const items = Array.isArray(item.items) ? item.items.map((entry) => text(entry, 'items')) : [];
        if (items.length === 0) throw new BlockRenderError('BLOCK_FIELD_REQUIRED', 'Список результатов чтения пуст.');
        rendered.push(`<LearnList items={${js(items)}} />`);
        break;
      }
      case 'article_step': {
        const content = sanitizeRichText(item.content);
        const linkedMedia = byReference(media, item.media);
        if (!linkedMedia) {
          rendered.push(`<h2>{${js(text(item.title, 'title'))}}</h2>\n\n${content}`);
          break;
        }
        use('ArticleStep');
        rendered.push(`<ArticleStep number={${Number(item.step_number)}} title={${js(text(item.title, 'title'))}} image={${js(mediaSource(linkedMedia))}} imageAlt={${js(text(linkedMedia.alt_text, 'alt_text'))}}${item.caption ? ` caption={${js(item.caption)}}` : ''}>\n${content}\n</ArticleStep>`);
        break;
      }
      case 'medical_notice': {
        use('MedicalNotice');
        const type = { standard: 'important', treatment: 'doctor', device: 'device', emergency: 'urgent' }[item.scope] ?? 'important';
        rendered.push(`<MedicalNotice type={${js(type)}}${item.title ? ` title={${js(item.title)}}` : ''}>\n${sanitizeRichText(item.content)}\n</MedicalNotice>`);
        break;
      }
      case 'figure': {
        use('ArticleFigure');
        const linkedMedia = byReference(media, item.media);
        rendered.push(`<ArticleFigure src={${js(mediaSource(linkedMedia))}} alt={${js(text(linkedMedia?.alt_text, 'alt_text'))}}${item.caption || linkedMedia?.caption ? ` caption={${js(item.caption ?? linkedMedia.caption)}}` : ''} />`);
        break;
      }
      case 'flow_diagram': {
        use('FlowDiagram');
        if (!Array.isArray(item.items) || item.items.length === 0) throw new BlockRenderError('BLOCK_FIELD_REQUIRED', 'Схема пуста.');
        const flowItems = item.items.map((entry) => ({ label: text(entry.label, 'items.label'), ...(entry.note ? { note: String(entry.note) } : {}) }));
        rendered.push(`<FlowDiagram title={${js(text(item.title, 'title'))}} items={${js(flowItems)}}${item.caption ? ` caption={${js(item.caption)}}` : ''} />`);
        break;
      }
      case 'source_story': {
        use('SourceStory');
        const source = byReference(sources, item.source, ['id', 'source_id']);
        if (!source) throw new BlockRenderError('SOURCE_NOT_FOUND', 'Карточка ссылается на отсутствующий источник.');
        rendered.push(`<SourceStory title={${js(item.title_override ?? source.title)}} href={${js(safeUrl(source.url))}}${item.kind ? ` kind={${js(item.kind)}}` : ''}${item.caution ? ` caution={${js(item.caution)}}` : ''}>\n${sanitizeRichText(item.content)}\n</SourceStory>`);
        break;
      }
      case 'sources':
        use('ArticleSources');
        rendered.push('<ArticleSources />');
        break;
      case 'next_material': {
        use('NextArticle');
        const target = byReference(related, item.target, ['id', 'content_id']);
        if (!target) throw new BlockRenderError('RELATED_MATERIAL_NOT_FOUND', 'Не найден следующий материал.');
        rendered.push(`<NextArticle href={${js(safeUrl(`/${String(target.slug).replace(/^\/+|\/+$/gu, '')}/`, { external: false }))}} title={${js(target.title)}} description={${js(item.description_override ?? target.description ?? '')}} />`);
        break;
      }
      case 'contact_prompt': {
        const label = text(item.label, 'label');
        rendered.push(`<a href={${js(safeUrl(item.href))}}>{${js(label)}}</a>`);
        break;
      }
      default:
        throw new BlockRenderError('BLOCK_TYPE_UNSUPPORTED', String(block.block_type));
    }
  }
  return { body: rendered.filter(Boolean).join('\n\n'), imports: [...imports].sort() };
}

export function importStatements(components, importBase) {
  return components.map((name) => `import ${name} from '${importBase}/${name}.astro';`).join('\n');
}
