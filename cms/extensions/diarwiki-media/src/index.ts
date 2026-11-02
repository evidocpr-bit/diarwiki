import { createError } from '@directus/errors';
import { defineHook } from '@directus/extensions-sdk';
import { readFile } from 'node:fs/promises';

import {
  auditMediaBuffer,
  resolveLocalFilePath,
  type MediaInput,
} from './validate-upload.ts';

type Database = any;
type Payload = Record<string, any>;
type Accountability = { user?: string | null } | null | undefined;
type Logger = {
  info: (data: unknown, message?: string) => void;
  warn: (data: unknown, message?: string) => void;
};

const MediaRejected = createError<{ findings: string[] }>(
  'DIARWIKI_MEDIA_REJECTED',
  ({ findings }) => `Медиафайл не прошёл проверку: ${findings.join(', ')}.`,
  422,
);

function metadataInput(file: Payload, media: Payload, byteSize: number): MediaInput {
  return {
    filename: file.filename_download,
    mimeType: file.type,
    byteSize,
    width: file.width,
    height: file.height,
    altText: media.alt_text,
    authorOrSource: media.author_or_source,
    rightsBasis: media.rights_basis,
  };
}

function findingCodes(problems: Array<{ code: string; detail?: string }>) {
  return problems.map(({ code, detail }) => detail ? `${code}:${detail}` : code);
}

async function auditRecord(database: Database, uploadRoot: string, media: Payload) {
  const fileId = typeof media.file === 'object' ? media.file?.id : media.file;
  if (!fileId) throw new MediaRejected({ findings: ['file_required'] });
  const file = await database('directus_files').where({ id: fileId }).first();
  if (!file) throw new MediaRejected({ findings: ['file_not_found'] });
  if (file.storage !== 'local') throw new MediaRejected({ findings: ['storage_not_supported'] });
  const path = resolveLocalFilePath(uploadRoot, file.filename_disk);
  const buffer = await readFile(path);
  const audit = auditMediaBuffer(buffer, metadataInput(file, media, buffer.length));
  if (audit.problems.length > 0) {
    throw new MediaRejected({ findings: findingCodes(audit.problems) });
  }
  return { file, audit, byteSize: buffer.length };
}

function auditFields(file: Payload, sha256: string, byteSize: number) {
  return {
    sha256,
    mime_type: file.type,
    byte_size: byteSize,
    width: file.width ?? null,
    height: file.height ?? null,
    security_status: 'passed',
    security_checked_at: new Date().toISOString(),
    security_findings: [],
  };
}

export default defineHook(({ filter, action }, { env, logger }) => {
  const uploadRoot = String(env.STORAGE_LOCAL_ROOT ?? '/directus/uploads');

  filter('items.create', async (payload: Payload, meta: { collection?: string }, context: { database: Database; accountability: Accountability }) => {
    if (meta.collection !== 'media_metadata') return payload;
    const { file, audit, byteSize } = await auditRecord(context.database, uploadRoot, payload);
    Object.assign(payload, auditFields(file, audit.sha256, byteSize), {
      uploaded_by: context.accountability?.user,
    });
    return payload;
  });

  filter('items.update', async (payload: Payload, meta: { collection?: string; keys?: string[] }, context: { database: Database }) => {
    if (meta.collection !== 'media_metadata') return payload;
    const ids = meta.keys ?? [];
    if (ids.length !== 1) throw new MediaRejected({ findings: ['bulk_update_forbidden'] });
    const current = await context.database('media_metadata').where({ id: ids[0] }).first();
    if (!current) throw new MediaRejected({ findings: ['metadata_not_found'] });
    const merged = { ...current, ...payload };
    const { file, audit, byteSize } = await auditRecord(context.database, uploadRoot, merged);
    Object.assign(payload, auditFields(file, audit.sha256, byteSize));
    return payload;
  });

  action('files.upload', async (meta: { key?: string }, context: { database: Database }) => {
    if (!meta.key) return;
    const media = await context.database('media_metadata').where({ file: meta.key }).first();
    if (!media) {
      (logger as Logger).info({ event: 'media.awaiting_metadata', file: meta.key }, 'DiarWiki file uploaded without public metadata');
      return;
    }
    try {
      const { file, audit, byteSize } = await auditRecord(context.database, uploadRoot, media);
      await context.database('media_metadata').where({ id: media.id }).update(auditFields(file, audit.sha256, byteSize));
      (logger as Logger).info({ event: 'media.rechecked', file: meta.key, status: 'passed' }, 'DiarWiki media rechecked');
    } catch (error) {
      const findings = error instanceof MediaRejected ? error.extensions.findings : ['audit_failed'];
      await context.database('media_metadata').where({ id: media.id }).update({
        security_status: 'failed',
        security_checked_at: new Date().toISOString(),
        security_findings: findings,
      });
      (logger as Logger).warn({ event: 'media.rechecked', file: meta.key, status: 'failed', findings }, 'DiarWiki media rejected');
    }
  });
});
