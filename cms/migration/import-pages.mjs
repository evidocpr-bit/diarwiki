import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { deterministicUuid, parseAttributes } from './parse-mdx.mjs';

const MONTHS = new Map([
  ['января', 1], ['февраля', 2], ['марта', 3], ['апреля', 4], ['мая', 5], ['июня', 6],
  ['июля', 7], ['августа', 8], ['сентября', 9], ['октября', 10], ['ноября', 11], ['декабря', 12],
]);

async function filesRecursively(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith('.astro')) result.push(path);
    }
  }
  await visit(root);
  return result;
}

function isoDate(value) {
  const match = String(value).match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s+года$/iu);
  if (!match || !MONTHS.has(match[2].toLocaleLowerCase('ru'))) return null;
  return `${match[3]}-${String(MONTHS.get(match[2].toLocaleLowerCase('ru'))).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function getPath(context, expression) {
  return expression.split('.').reduce((value, part) => value?.[part], context);
}

function resolveExpressions(body, context) {
  let result = body;
  result = result.replace(/\{email\s*\?\s*\(\s*<>\s*([\s\S]*?)\s*<\/>(?:\s*)\)\s*:\s*\([\s\S]*?\)\s*\}/gu, '$1');
  result = result.replace(/\{`mailto:\$\{(email|editorEmail)\}(?:\?subject=\$\{encodeURIComponent\('([^']+)'\)\})?`\}/gu,
    (_, field, subject) => `"mailto:${context[field]}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}"`);
  result = result.replace(/\{`Перейти на сайт \$\{evidoc\.nameGenitive\}`\}/gu,
    `"Перейти на сайт ${context.evidoc.nameGenitive}"`);
  result = result.replace(/=\{([A-Za-z][A-Za-z\d]*(?:\.[A-Za-z][A-Za-z\d]*)*)\}/gu, (_, expression) => {
    const value = getPath(context, expression);
    if (value === undefined || value === null) throw new Error(`PAGE_EXPRESSION_UNRESOLVED: ${expression}`);
    return `="${String(value).replaceAll('"', '&quot;')}"`;
  });
  result = result.replace(/\{([A-Za-z][A-Za-z\d]*(?:\.[A-Za-z][A-Za-z\d]*)*)\}/gu, (_, expression) => {
    const value = getPath(context, expression);
    if (value === undefined || value === null) throw new Error(`PAGE_EXPRESSION_UNRESOLVED: ${expression}`);
    return String(value);
  });
  const unresolved = result.match(/\{[^}]+\}/u)?.[0];
  if (unresolved) throw new Error(`PAGE_EXPRESSION_UNSUPPORTED: ${unresolved.slice(0, 160)}`);
  return result;
}

function cleanBody(body) {
  return body
    .replace(/<style>[\s\S]*?<\/style>/giu, '')
    .replace(/<p>\s*<a\b([^>]*)>\s*<img\b([^>]*)\/?>\s*<\/a>\s*<\/p>/giu, (_, linkAttrs, imageAttrs) => {
      const href = linkAttrs.match(/href="([^"]+)"/u)?.[1] ?? '#';
      const alt = imageAttrs.match(/alt="([^"]+)"/u)?.[1] ?? 'Перейти на сайт партнёра';
      return `<p><a href="${href}">${alt}</a></p>`;
    })
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\saria-label="[^"]*"/gu, '')
    .trim();
}

export async function importPages(workspaceRoot) {
  const pagesRoot = join(workspaceRoot, 'site', 'src', 'pages');
  const siteModule = await import(pathToFileURL(join(workspaceRoot, 'site', 'src', 'config', 'site.ts')).href);
  const identity = siteModule.siteIdentity;
  const context = {
    ...identity,
    curator: identity.curator,
    evidoc: identity.evidoc,
    owner: identity.owner,
    mission: identity.mission,
    editorEmail: identity.editorEmail,
    email: identity.editorEmail,
  };
  const pages = [];
  const skipped = [];
  for (const path of await filesRecursively(pagesRoot)) {
    const source = await readFile(path, 'utf8');
    const layoutStart = source.indexOf('<TextPageLayout');
    if (layoutStart < 0) { skipped.push(relative(pagesRoot, path).replaceAll('\\', '/')); continue; }
    const openEnd = source.indexOf('>', layoutStart);
    const closeStart = source.indexOf('</TextPageLayout>', openEnd);
    if (openEnd < 0 || closeStart < 0) throw new Error(`PAGE_LAYOUT_INVALID: ${path}`);
    const attributes = parseAttributes(source.slice(layoutStart + '<TextPageLayout'.length, openEnd));
    const relativePath = relative(pagesRoot, path).replaceAll('\\', '/');
    if (relativePath === 'sources.astro') {
      skipped.push(relativePath);
      continue;
    }
    const slug = relativePath.replace(/\.astro$/u, '').replace(/\/index$/u, '');
    const rawBody = source.slice(openEnd + 1, closeStart).replace(/<style>[\s\S]*?<\/style>/giu, '');
    const body = cleanBody(resolveExpressions(rawBody, context));
    pages.push({
      id: deterministicUuid(`page:${slug}`),
      page_id: `page-${slug.replaceAll('/', '-')}`,
      slug,
      title: attributes.title,
      summary: attributes.description ?? attributes.title,
      body,
      workflow_status: 'ready_to_publish',
      template_key: 'standard',
      public_updated_at: isoDate(attributes.updated),
      source_file: relative(workspaceRoot, path).replaceAll('\\', '/'),
    });
  }
  pages.sort((left, right) => left.slug.localeCompare(right.slug, 'en'));
  skipped.sort((left, right) => left.localeCompare(right, 'en'));
  return { pages, skipped };
}
