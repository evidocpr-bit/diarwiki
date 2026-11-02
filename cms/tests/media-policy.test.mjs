import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditMediaInventory } from '../scripts/media-audit.mjs';
import {
  auditMediaBuffer,
  inspectSvg,
  resolveLocalFilePath,
  validateMediaMetadata,
} from '../extensions/diarwiki-media/src/validate-upload.ts';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

test('valid PNG metadata and signature pass', () => {
  const result = auditMediaBuffer(PNG, {
    filename: 'diagram.png',
    mimeType: 'image/png',
    byteSize: PNG.length,
    width: 1600,
    height: 900,
    altText: 'Схема действий при гипогликемии',
    authorOrSource: 'DiarWiki',
    rightsBasis: 'Собственная схема редакции',
  });
  assert.deepEqual(result.problems, []);
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
});

test('extension, MIME and file signature must agree', () => {
  const result = auditMediaBuffer(PNG, {
    filename: 'diagram.jpg',
    mimeType: 'image/jpeg',
    byteSize: PNG.length,
    width: 100,
    height: 100,
    altText: 'Описание',
    authorOrSource: 'Автор',
    rightsBasis: 'Разрешение',
  });
  assert.ok(result.problems.some(({ code }) => code === 'signature_mismatch'));
});

test('oversized files and excessive image dimensions fail', () => {
  const problems = validateMediaMetadata({
    filename: 'large.png',
    mimeType: 'image/png',
    byteSize: 21 * 1024 * 1024,
    width: 13000,
    height: 900,
    altText: 'Описание',
    authorOrSource: 'Автор',
    rightsBasis: 'Разрешение',
  });
  assert.ok(problems.some(({ code }) => code === 'file_too_large'));
  assert.ok(problems.some(({ code }) => code === 'image_dimensions_excessive'));
});

test('public media requires alt text, attribution and rights basis', () => {
  const problems = validateMediaMetadata({
    filename: 'image.webp',
    mimeType: 'image/webp',
    byteSize: 10,
    width: 100,
    height: 100,
    altText: ' ',
    authorOrSource: '',
    rightsBasis: '',
  });
  assert.deepEqual(new Set(problems.map(({ code }) => code)), new Set([
    'alt_text_required',
    'author_required',
    'rights_basis_required',
  ]));
});

test('safe SVG is accepted', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Круг</title><circle cx="5" cy="5" r="4"/></svg>`;
  assert.deepEqual(inspectSvg(svg), []);
  const result = auditMediaBuffer(Buffer.from(svg), {
    filename: 'circle.svg',
    mimeType: 'image/svg+xml',
    byteSize: Buffer.byteLength(svg),
    width: 10,
    height: 10,
    altText: 'Круг',
    authorOrSource: 'DiarWiki',
    rightsBasis: 'Собственная схема',
  });
  assert.deepEqual(result.problems, []);
});

test('SVG scripts, event handlers, foreign objects and external links are rejected', () => {
  for (const [fragment, expected] of [
    ['<script>alert(1)</script>', 'svg_script_forbidden'],
    ['<circle onload="alert(1)"/>', 'svg_event_handler_forbidden'],
    ['<foreignObject><div>HTML</div></foreignObject>', 'svg_active_element_forbidden'],
    ['<image href="https://tracker.example/pixel.png"/>', 'svg_external_reference_forbidden'],
    ['<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>', 'svg_doctype_forbidden'],
  ]) {
    const problems = inspectSvg(`<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`);
    assert.ok(problems.some(({ code }) => code === expected), fragment);
  }
});

test('PDF and raster magic bytes are detected conservatively', () => {
  const pdf = Buffer.from('%PDF-1.7\n');
  const result = auditMediaBuffer(pdf, {
    filename: 'memo.pdf',
    mimeType: 'application/pdf',
    byteSize: pdf.length,
    altText: 'Памятка',
    authorOrSource: 'Организация',
    rightsBasis: 'Разрешено распространение',
  });
  assert.deepEqual(result.problems, []);
});

test('local storage paths cannot escape the upload root', () => {
  assert.match(resolveLocalFilePath('/srv/uploads', 'safe-file.png'), /safe-file\.png$/u);
  assert.throws(() => resolveLocalFilePath('/srv/uploads', '../secret.txt'), { code: 'MEDIA_PATH_ESCAPE' });
  assert.throws(() => resolveLocalFilePath('/srv/uploads', '/etc/passwd'), { code: 'MEDIA_PATH_ESCAPE' });
});

test('inventory audit updates only metadata records and leaves orphan files untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diarwiki-media-'));
  try {
    await writeFile(join(root, 'safe.png'), PNG);
    const patches = [];
    const api = {
      async get(path) {
        if (path.startsWith('/files')) return [
          { id: 'file-1', storage: 'local', filename_disk: 'safe.png', filename_download: 'safe.png', type: 'image/png', width: 10, height: 10 },
          { id: 'orphan', storage: 'local', filename_disk: 'orphan.png', filename_download: 'orphan.png', type: 'image/png', width: 10, height: 10 },
        ];
        return [{ id: 'meta-1', file: 'file-1', alt_text: 'Схема', author_or_source: 'DiarWiki', rights_basis: 'Собственная работа' }];
      },
      async patch(path, payload) { patches.push({ path, payload }); },
    };
    const result = await auditMediaInventory({ api, uploadsRoot: root, apply: true });
    assert.equal(result.failedCount, 0);
    assert.equal(result.orphanFileCount, 1);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].payload.security_status, 'passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
