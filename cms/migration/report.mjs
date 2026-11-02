function countBy(items, field) {
  return Object.fromEntries([...new Set(items.map((item) => item[field]))]
    .sort((left, right) => String(left).localeCompare(String(right), 'en'))
    .map((value) => [String(value), items.filter((item) => item[field] === value).length]));
}

function duplicateValues(items, field) {
  const counts = new Map();
  for (const item of items) counts.set(item[field], (counts.get(item[field]) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
}

export function createMigrationReport(bundle) {
  const { collections } = bundle;
  const problems = [];
  const blockers = [];
  for (const collection of ['materials', 'sources', 'library_items', 'pages', 'navigation', 'media_metadata']) {
    const duplicates = duplicateValues(collections[collection], 'id');
    if (duplicates.length) problems.push({ code: 'DUPLICATE_ID', collection, values: duplicates });
  }
  for (const field of ['content_id', 'slug']) {
    const duplicates = duplicateValues(collections.materials, field);
    if (duplicates.length) problems.push({ code: 'DUPLICATE_MATERIAL_IDENTITY', field, values: duplicates });
  }
  for (const block of collections.material_blocks) {
    const item = collections[block.item?.collection]?.find((candidate) => candidate.id === block.item?.item);
    if (!item) problems.push({ code: 'BLOCK_ITEM_MISSING', block: block.id });
  }
  for (const media of collections.media_metadata) {
    if (media.security_status !== 'passed') blockers.push({ code: 'MEDIA_SECURITY_FAILED', subject: media.id });
    if (media.rights_status !== 'approved') blockers.push({ code: 'MEDIA_RIGHTS_CONFIRMATION_REQUIRED', subject: media.id });
  }
  for (const material of collections.materials) {
    if (material.risk === 'high' && material.medical_review_status !== 'reviewed') {
      blockers.push({ code: 'CURRENT_MEDICAL_REVIEW_REQUIRED', subject: material.content_id });
    }
  }

  const counts = Object.fromEntries(Object.entries(collections).map(([name, items]) => [name, items.length]));
  const codeManagedPages = bundle.provenance.code_managed_pages;
  const lines = [
    '# Отчёт миграции действующего содержимого в CMS',
    '',
    `Источник: \`${bundle.source_commit}\`. Сформировано: ${bundle.generated_at}.`,
    '',
    '## Перенесено',
    '',
    `- Материалы: ${counts.materials}.`,
    `- Структурированные блоки: ${counts.material_blocks}.`,
    `- Источники: ${counts.sources}; связей материалов с источниками: ${counts.material_sources}.`,
    `- Ресурсы библиотеки: ${counts.library_items}.`,
    `- Редактируемые служебные страницы: ${counts.pages}.`,
    `- Элементы навигации: ${counts.navigation}.`,
    `- Медиафайлы статей: ${counts.media_metadata}.`,
    '',
    'Ни одна отметка медицинской проверки не создана без полного набора имени, специальности, даты и отпечатка версии.',
    '',
    '## Перед первым выпуском из CMS',
    '',
    blockers.length
      ? `Остаётся блокирующих условий: ${blockers.length}. Они перечислены в JSON-отчёте с кодом и стабильным идентификатором.`
      : 'Блокирующих условий в подготовленном пакете не найдено.',
    'Права на перенесённые иллюстрации намеренно оставлены в состоянии `pending`: подтверждение не подменяется предположением.',
    'Материалы высокого риска остаются без значка проверки до фактической рецензии текущей версии.',
    '',
    '## Страницы, которые остаются в коде',
    '',
    ...(codeManagedPages.length ? codeManagedPages.map((path) => `- \`${path}\``) : ['- Нет.']),
    '',
    'Это динамические, индексные или инструментальные маршруты. Они используют данные CMS, но не должны редактироваться как произвольный HTML.',
    '',
    '## Контроль переключения',
    '',
    '- Пакет подготовлен офлайн; запись в Directus и переключение публичного сайта не выполнялись.',
    '- До переключения необходимы применение технической схемы Directus, подтверждение прав на медиа и сборка из неизменяемого снимка.',
    '- После тестовой загрузки требуется сравнить маршруты, видимый текст, ссылки, изображения, метаданные и поисковый индекс с действующей сборкой.',
    '',
  ];

  return {
    schema_version: 1,
    source_commit: bundle.source_commit,
    generated_at: bundle.generated_at,
    counts,
    material_statuses: countBy(collections.materials, 'workflow_status'),
    material_risks: countBy(collections.materials, 'risk'),
    blockers,
    problems,
    code_managed_pages: codeManagedPages,
    safe_to_apply: problems.length === 0,
    safe_to_publish: problems.length === 0 && blockers.length === 0,
    markdown: `${lines.join('\n')}\n`,
  };
}
