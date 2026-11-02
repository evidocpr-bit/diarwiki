import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { DirectusApi } from '../bootstrap/directus-api.mjs';
import {
  auditMediaBuffer,
  resolveLocalFilePath,
} from '../extensions/diarwiki-media/src/validate-upload.ts';

function parseArguments(argv) {
  const options = {
    apply: false,
    tokenEnv: 'DIRECTUS_MEDIA_AUDIT_TOKEN',
    uploads: undefined,
    url: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--apply') options.apply = true;
    else if (argv[index] === '--uploads') options.uploads = argv[++index];
    else if (argv[index] === '--url') options.url = argv[++index];
    else if (argv[index] === '--token-env') options.tokenEnv = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

function fileId(value) {
  return typeof value === 'object' ? value?.id : value;
}

function inputFor(file, metadata, size) {
  return {
    filename: file.filename_download,
    mimeType: file.type,
    byteSize: size,
    width: file.width,
    height: file.height,
    altText: metadata.alt_text,
    authorOrSource: metadata.author_or_source,
    rightsBasis: metadata.rights_basis,
  };
}

export async function auditMediaInventory({ api, uploadsRoot, apply = false }) {
  const [files, metadataRows] = await Promise.all([
    api.get('/files?limit=-1'),
    api.get('/items/media_metadata?limit=-1'),
  ]);
  const filesById = new Map(files.map((file) => [file.id, file]));
  const results = [];

  for (const metadata of metadataRows) {
    const id = fileId(metadata.file);
    const file = filesById.get(id);
    let sha256;
    let problems = [];
    try {
      if (!file) throw new Error('file_not_found');
      if (file.storage !== 'local') throw new Error('storage_not_supported');
      const buffer = await readFile(resolveLocalFilePath(uploadsRoot, file.filename_disk));
      const audit = auditMediaBuffer(buffer, inputFor(file, metadata, buffer.length));
      sha256 = audit.sha256;
      problems = audit.problems.map(({ code, detail }) => detail ? `${code}:${detail}` : code);
      if (apply) {
        await api.patch(`/items/media_metadata/${metadata.id}`, {
          sha256,
          mime_type: file.type,
          byte_size: buffer.length,
          width: file.width ?? null,
          height: file.height ?? null,
          security_status: problems.length === 0 ? 'passed' : 'failed',
          security_checked_at: new Date().toISOString(),
          security_findings: problems,
        });
      }
    } catch (error) {
      problems = [error instanceof Error ? error.message : 'audit_failed'];
      if (apply) {
        await api.patch(`/items/media_metadata/${metadata.id}`, {
          security_status: 'failed',
          security_checked_at: new Date().toISOString(),
          security_findings: problems,
        });
      }
    }
    results.push({ metadata: metadata.id, file: id, sha256, problems });
  }

  const linked = new Set(metadataRows.map(({ file }) => fileId(file)));
  return {
    results,
    orphanFileCount: files.filter(({ id }) => !linked.has(id)).length,
    failedCount: results.filter(({ problems }) => problems.length > 0).length,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.url || !options.uploads) {
    throw new Error('Укажите --url <Directus> и --uploads <каталог>.');
  }
  const token = process.env[options.tokenEnv];
  if (!token) throw new Error(`Переменная ${options.tokenEnv} не задана.`);
  const result = await auditMediaInventory({
    api: new DirectusApi(options.url, token),
    uploadsRoot: options.uploads,
    apply: options.apply,
  });
  console.log(`Проверено медиа: ${result.results.length}; ошибок: ${result.failedCount}; файлов без публичных метаданных: ${result.orphanFileCount}.`);
  for (const item of result.results.filter(({ problems }) => problems.length > 0)) {
    console.error(`- metadata=${item.metadata}: ${item.problems.join(', ')}`);
  }
  if (!options.apply) console.log('Режим чтения: статусы в Directus не изменялись.');
  if (result.failedCount > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
