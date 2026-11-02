function id(value) { return typeof value === 'object' ? value?.id : value; }
function sourceId(value, sourcesById) {
  if (typeof value === 'object') return value?.source_id ?? value?.id;
  return sourcesById.get(value)?.source_id ?? value;
}
function contentId(value, materialsById) {
  if (typeof value === 'object') return value?.content_id ?? value?.id;
  return materialsById.get(value)?.content_id ?? value;
}

function query(collection, parameters = {}) {
  const search = new URLSearchParams(parameters);
  return `/items/${collection}?${search}`;
}

async function all(api, collection, parameters = {}) {
  return api.get(query(collection, { limit: '-1', ...parameters }));
}

export async function fetchReleaseInput(api, request, options = {}) {
  const materials = await all(api, 'materials', {
    'filter[workflow_status][_in]': 'ready_to_publish,published',
    fields: '*', sort: 'content_id',
  });
  const hasSelection = Array.isArray(request.material_ids) && request.material_ids.length > 0;
  const materialIds = new Set((request.material_ids ?? []).map(id));
  const selected = materials.filter((material) => material.workflow_status === 'published'
    || !hasSelection
    || materialIds.has(material.id)
    || materialIds.has(material.content_id));
  const materialsById = new Map(materials.map((material) => [material.id, material]));
  const sources = await all(api, 'sources', { fields: '*', sort: 'source_id' });
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const mediaById = new Map();
  const mediaFiles = new Map();

  for (const material of selected) {
    const blocks = await all(api, 'material_blocks', {
      'filter[material][_eq]': material.id,
      fields: 'id,sort_order,block_type,collection,item.*,item.media.*,item.source.*,item.target.*',
      sort: 'sort_order,id',
    });
    material.blocks = blocks.map((block) => {
      const payload = block.item?.item ?? block.item ?? {};
      if (block.block_type === 'source_story') payload.source = sourceId(payload.source, sourcesById);
      if (block.block_type === 'next_material') payload.target = contentId(payload.target, materialsById);
      const linkedMedia = payload.media;
      if (linkedMedia && typeof linkedMedia === 'object') {
        mediaById.set(linkedMedia.id, linkedMedia);
        payload.media = linkedMedia.id;
      }
      return { id: block.id, sort_order: block.sort_order, block_type: block.block_type, item: payload };
    });

    const sourceLinks = await all(api, 'material_sources', {
      'filter[material][_eq]': material.id, fields: 'sort_order,note,source.*', sort: 'sort_order',
    });
    material.sources = sourceLinks.map((link) => link.source);
    const relatedLinks = await all(api, 'material_relations', {
      'filter[material][_eq]': material.id, fields: 'sort_order,related_material.*', sort: 'sort_order',
    });
    material.related = relatedLinks.map((link) => link.related_material);
  }

  for (const mediaId of new Set(selected.flatMap((material) => material.blocks)
    .map((block) => block.item?.media).filter(Boolean))) {
    if (!mediaById.has(mediaId)) mediaById.set(mediaId, await api.get(`/items/media_metadata/${encodeURIComponent(mediaId)}?fields=*,file.*`));
  }
  for (const media of mediaById.values()) {
    const file = typeof media.file === 'object' ? media.file : await api.get(`/files/${encodeURIComponent(media.file)}`);
    media.filename = file.filename_download;
    media.mime_type = media.mime_type ?? file.type;
    mediaFiles.set(media.sha256, { sha256: media.sha256, mime_type: media.mime_type, file_id: file.id });
  }
  for (const material of selected) {
    const ids = new Set(material.blocks.map((block) => block.item?.media).filter(Boolean));
    material.media = [...ids].map((mediaId) => mediaById.get(mediaId));
  }

  const [libraryItems, pages, navigation, siteSettings, medicalReviews, redirects] = await Promise.all([
    all(api, 'library_items', { fields: '*', sort: 'library_id' }),
    all(api, 'pages', { 'filter[workflow_status][_in]': 'ready_to_publish,published', fields: '*', sort: 'page_id' }),
    all(api, 'navigation', { fields: '*', sort: 'placement,sort_order,id' }),
    api.get('/items/site_settings'),
    all(api, 'medical_reviews', { fields: '*', sort: '-reviewed_at' }),
    all(api, 'redirects', { fields: '*', sort: 'from_path' }),
  ]);

  return {
    snapshotInput: {
      source_commit: options.sourceCommit,
      release_request_id: request.id,
      materials: selected,
      sources,
      library_items: libraryItems,
      pages,
      navigation,
      site_settings: siteSettings,
      medical_reviews: medicalReviews,
      redirects,
    },
    mediaFiles: [...mediaFiles.values()],
  };
}

export async function downloadReleaseMedia(api, mediaFiles, outputRoot) {
  const { mkdir, open } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const extensions = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'image/svg+xml': '.svg', 'application/pdf': '.pdf',
  };
  for (const media of mediaFiles) {
    const extension = extensions[media.mime_type];
    if (!extension || !/^[a-f\d]{64}$/u.test(media.sha256)) throw new Error('RELEASE_MEDIA_INVALID');
    const response = await api.fetch(`/assets/${encodeURIComponent(media.file_id)}`);
    if (!response.ok) throw new Error(`RELEASE_MEDIA_DOWNLOAD_FAILED: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const { createHash } = await import('node:crypto');
    if (createHash('sha256').update(bytes).digest('hex') !== media.sha256) throw new Error('RELEASE_MEDIA_HASH_MISMATCH');
    const path = join(outputRoot, `${media.sha256}${extension}`);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'wx');
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
  }
}
