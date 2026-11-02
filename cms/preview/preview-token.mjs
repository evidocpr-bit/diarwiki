import { createHmac, timingSafeEqual } from 'node:crypto';

export const PREVIEW_ID_PATTERN = /^pv-[a-z0-9][a-z0-9-]{5,63}$/u;
export const MAX_PREVIEW_TTL_SECONDS = 24 * 60 * 60;

function assertSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || /^(?:change|replace|example)/iu.test(secret)) {
    throw new Error('PREVIEW_SECRET_INVALID');
  }
}

function signature(secret, previewId, expires) {
  return createHmac('sha256', secret).update(`v1\n${previewId}\n${expires}`).digest('base64url');
}

export function createPreviewGrant(secret, previewId, options = {}) {
  assertSecret(secret);
  if (!PREVIEW_ID_PATTERN.test(previewId)) throw new Error('PREVIEW_ID_INVALID');
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const ttlSeconds = Number(options.ttlSeconds ?? 60 * 60);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_PREVIEW_TTL_SECONDS) {
    throw new Error('PREVIEW_TTL_INVALID');
  }
  const expires = nowSeconds + ttlSeconds;
  const sig = signature(secret, previewId, expires);
  return { previewId, expires, signature: sig, token: `${previewId}.${expires}.${sig}` };
}

export function verifyPreviewGrant(secret, token, options = {}) {
  try { assertSecret(secret); } catch { return { valid: false, code: 'PREVIEW_SECRET_INVALID' }; }
  const match = String(token ?? '').match(/^(pv-[a-z0-9][a-z0-9-]{5,63})\.(\d{10})\.([A-Za-z\d_-]{43})$/u);
  if (!match) return { valid: false, code: 'PREVIEW_TOKEN_INVALID' };
  const previewId = match[1];
  const expires = Number(match[2]);
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (expires <= nowSeconds) return { valid: false, code: 'PREVIEW_TOKEN_EXPIRED' };
  if (expires - nowSeconds > MAX_PREVIEW_TTL_SECONDS + 60) return { valid: false, code: 'PREVIEW_TOKEN_TTL_EXCEEDED' };
  const expected = Buffer.from(signature(secret, previewId, expires));
  const actual = Buffer.from(match[3]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { valid: false, code: 'PREVIEW_SIGNATURE_INVALID' };
  }
  return { valid: true, previewId, expires };
}

export function createPreviewAccessUrl(origin, grant) {
  const url = new URL('/access', origin);
  url.searchParams.set('preview', grant.previewId);
  url.searchParams.set('expires', String(grant.expires));
  url.searchParams.set('signature', grant.signature);
  return url.href;
}

export function grantFromQuery(url) {
  const previewId = url.searchParams.get('preview') ?? '';
  const expires = url.searchParams.get('expires') ?? '';
  const sig = url.searchParams.get('signature') ?? '';
  return `${previewId}.${expires}.${sig}`;
}
