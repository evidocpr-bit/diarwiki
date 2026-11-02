import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { deterministicUuid } from './parse-mdx.mjs';

function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(value); value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = []; value = '';
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

export async function importLibrary(workspaceRoot) {
  const moduleUrl = pathToFileURL(`${workspaceRoot}/site/src/lib/library.ts`.replaceAll('\\', '/')).href;
  const { getLibraryResources } = await import(moduleUrl);
  const resources = getLibraryResources();
  const catalog = parseCsv(await readFile(`${workspaceRoot}/library/catalog.csv`, 'utf8'));
  const rows = new Map(catalog.map((row) => [row.id, row]));

  return resources.map((resource) => {
    const row = rows.get(resource.id);
    if (!row) throw new Error(`LIBRARY_CATALOG_ROW_MISSING: ${resource.id}`);
    const pendingPermission = ['rights_pending', 'admin_consent_pending'].includes(row.public_link_status);
    return {
      id: deterministicUuid(`library:${resource.id}`),
      library_id: resource.id,
      slug: resource.slug,
      title: resource.title,
      description: resource.summary,
      category: resource.category.id,
      resource_type: resource.resourceType,
      author_or_organization: resource.authors || null,
      publisher: resource.publisher || null,
      source_year: resource.year || null,
      language: resource.language || null,
      format: resource.format || null,
      pages: resource.pages || null,
      editorial_status: resource.status || null,
      benefit: resource.benefit || null,
      caution: resource.caution || null,
      rights_note: resource.rights || null,
      topics: resource.topics,
      featured: resource.featured,
      access_label: resource.accessLabel || null,
      additional_links: resource.telegramAlternatives,
      public_url: pendingPermission ? null : (resource.accessUrl || null),
      alternative_url: resource.authorsUrl || resource.collectionUrl || null,
      public_link_status: pendingPermission ? 'hidden_pending_permission' : 'public',
      medical_review_status: 'pending',
      rights_status: pendingPermission ? 'pending' : 'approved',
      last_checked_at: resource.lastReviewed || null,
      archived: false,
    };
  });
}
