import { createServer } from 'node:http';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { grantFromQuery, verifyPreviewGrant } from './preview-token.mjs';

const COOKIE_NAME = 'dw_preview';

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

async function previewExists(root, previewId) {
  try {
    const entry = await lstat(resolve(root, 'p', previewId));
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch { return false; }
}

export function createPreviewAuthHandler(options) {
  const origin = new URL(options.origin);
  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? '/', origin);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (url.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"status":"ok"}');
        return;
      }
      if (url.pathname === '/access') {
        const token = grantFromQuery(url);
        const result = verifyPreviewGrant(options.secret, token);
        if (!result.valid || !await previewExists(options.previewRoot, result.previewId)) {
          response.writeHead(401); response.end('Ссылка предпросмотра недействительна или истекла.'); return;
        }
        const maxAge = Math.max(1, result.expires - Math.floor(Date.now() / 1000));
        response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`);
        response.writeHead(303, { Location: '/' });
        response.end();
        return;
      }
      if (url.pathname === '/authorize') {
        const token = cookieValue(request.headers.cookie, COOKIE_NAME);
        const result = verifyPreviewGrant(options.secret, token);
        if (!result.valid || !await previewExists(options.previewRoot, result.previewId)) {
          response.writeHead(401); response.end(); return;
        }
        response.setHeader('X-Preview-Id', result.previewId);
        response.writeHead(204); response.end(); return;
      }
      response.writeHead(404); response.end();
    } catch {
      response.writeHead(500); response.end();
    }
  };
}

async function main() {
  const secret = process.env.DIARWIKI_PREVIEW_SECRET;
  const previewRoot = process.env.DIARWIKI_PREVIEW_ROOT ?? '/srv/diarwiki-previews';
  const origin = process.env.DIARWIKI_PREVIEW_ORIGIN ?? 'https://preview.diarwiki.ru';
  if (!secret) throw new Error('DIARWIKI_PREVIEW_SECRET_REQUIRED');
  const port = Number(process.env.DIARWIKI_PREVIEW_AUTH_PORT ?? 8061);
  const server = createServer(createPreviewAuthHandler({ secret, previewRoot, origin }));
  server.listen(port, '127.0.0.1', () => console.log(`Preview authorization service listens on 127.0.0.1:${port}.`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
