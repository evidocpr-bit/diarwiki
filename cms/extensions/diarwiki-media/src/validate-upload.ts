import { createHash } from 'node:crypto';
import { extname, isAbsolute, relative, resolve } from 'node:path';

export const MEDIA_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxAxis: 12_000,
  maxPixels: 80_000_000,
});

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
  'application/pdf': ['.pdf'],
});

export type MediaInput = {
  filename: string;
  mimeType: string;
  byteSize: number;
  width?: number | null;
  height?: number | null;
  altText: string;
  authorOrSource: string;
  rightsBasis: string;
};

export type MediaProblem = { code: string; detail?: string };

export class MediaPathError extends Error {
  code = 'MEDIA_PATH_ESCAPE';
}

function addProblem(problems: MediaProblem[], code: string, detail?: string) {
  problems.push({ code, ...(detail ? { detail } : {}) });
}

export function validateMediaMetadata(input: MediaInput) {
  const problems: MediaProblem[] = [];
  const extensions = MIME_EXTENSIONS[input.mimeType];
  const extension = extname(input.filename).toLowerCase();
  if (!extensions) addProblem(problems, 'mime_type_forbidden', input.mimeType);
  else if (!extensions.includes(extension)) addProblem(problems, 'extension_mismatch', extension);
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) addProblem(problems, 'file_empty');
  else if (input.byteSize > MEDIA_LIMITS.maxBytes) addProblem(problems, 'file_too_large');

  if (input.mimeType.startsWith('image/') && input.mimeType !== 'image/svg+xml') {
    if (!input.width || !input.height || input.width < 1 || input.height < 1) {
      addProblem(problems, 'image_dimensions_missing');
    } else if (input.width > MEDIA_LIMITS.maxAxis
      || input.height > MEDIA_LIMITS.maxAxis
      || input.width * input.height > MEDIA_LIMITS.maxPixels) {
      addProblem(problems, 'image_dimensions_excessive');
    }
  }
  if (input.mimeType === 'image/svg+xml' && input.width && input.height
    && (input.width > MEDIA_LIMITS.maxAxis || input.height > MEDIA_LIMITS.maxAxis)) {
    addProblem(problems, 'image_dimensions_excessive');
  }
  if (!input.altText?.trim()) addProblem(problems, 'alt_text_required');
  if (!input.authorOrSource?.trim()) addProblem(problems, 'author_required');
  if (!input.rightsBasis?.trim()) addProblem(problems, 'rights_basis_required');
  return problems;
}

export function resolveLocalFilePath(root: string, filenameDisk: string) {
  if (!filenameDisk || isAbsolute(filenameDisk)) throw new MediaPathError('Недопустимый путь медиафайла.');
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, filenameDisk);
  const relation = relative(rootPath, candidate);
  if (relation.startsWith('..') || isAbsolute(relation)) throw new MediaPathError('Путь выходит за каталог загрузок.');
  return candidate;
}

export function inspectSvg(svg: string) {
  const problems: MediaProblem[] = [];
  const normalized = svg.replace(/^\uFEFF/u, '');
  if (!/<svg(?:\s|>)/iu.test(normalized)) addProblem(problems, 'svg_root_missing');
  if (/<!DOCTYPE|<!ENTITY/iu.test(normalized)) addProblem(problems, 'svg_doctype_forbidden');
  if (/<\s*script(?:\s|>)/iu.test(normalized)) addProblem(problems, 'svg_script_forbidden');
  if (/<\s*(?:foreignObject|iframe|object|embed|audio|video)(?:\s|>)/iu.test(normalized)) {
    addProblem(problems, 'svg_active_element_forbidden');
  }
  if (/\son[a-z][a-z\d_-]*\s*=/iu.test(normalized)) addProblem(problems, 'svg_event_handler_forbidden');
  if (/\b(?:href|xlink:href)\s*=\s*["'](?!#)[^"']+["']/iu.test(normalized)
    || /url\s*\(\s*["']?(?!#)[^)]+\)/iu.test(normalized)) {
    addProblem(problems, 'svg_external_reference_forbidden');
  }
  if (/javascript\s*:|@import|expression\s*\(/iu.test(normalized)) {
    addProblem(problems, 'svg_active_content_forbidden');
  }
  return problems;
}

export function detectMimeType(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  const start = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').replace(/^\uFEFF/u, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(start)) return 'image/svg+xml';
  return undefined;
}

export function auditMediaBuffer(buffer: Buffer, input: MediaInput) {
  const problems = validateMediaMetadata(input);
  const detectedMimeType = detectMimeType(buffer);
  if (detectedMimeType !== input.mimeType) {
    addProblem(problems, 'signature_mismatch', detectedMimeType ?? 'unknown');
  }
  if (input.mimeType === 'image/svg+xml' && detectedMimeType === 'image/svg+xml') {
    problems.push(...inspectSvg(buffer.toString('utf8')));
  }
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    detectedMimeType,
    problems,
  };
}
