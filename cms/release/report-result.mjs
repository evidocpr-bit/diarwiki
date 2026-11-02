const SAFE_CODE = /^[A-Z][A-Z\d_]{2,79}$/u;

export function releaseError(error) {
  const rawCode = error?.code ?? String(error?.message ?? '').split(':', 1)[0];
  const code = SAFE_CODE.test(rawCode) ? rawCode : 'RELEASE_FAILED';
  const summary = String(error?.message ?? 'Сбой выпуска')
    .replace(/Bearer\s+[A-Za-z\d._~-]+/giu, 'Bearer [redacted]')
    .replace(/(token|password|secret|key)\s*[=:]\s*\S+/giu, '$1=[redacted]')
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, 500);
  return { code, summary };
}

export async function reportReleaseSuccess(api, request, release, options = {}) {
  await api.post('/items/releases', release);
  for (const material of options.materials ?? []) {
    await api.patch(`/items/materials/${encodeURIComponent(material.id)}`, {
      workflow_status: 'published', published_at: release.activated_at,
    });
  }
  for (const page of options.pages ?? []) {
    await api.patch(`/items/pages/${encodeURIComponent(page.id)}`, { workflow_status: 'published' });
  }
  await api.patch(`/items/release_requests/${encodeURIComponent(request.id)}`, {
    status: 'published', last_error_code: null, last_error_summary: null,
  });
}

export async function reportReleaseFailure(api, request, error, options = {}) {
  const safe = releaseError(error);
  await api.patch(`/items/release_requests/${encodeURIComponent(request.id)}`, {
    status: 'failed', last_error_code: safe.code, last_error_summary: safe.summary,
    attempt_count: Number(request.attempt_count ?? 0) + (options.incrementAttempt === false ? 0 : 1),
  });
  return safe;
}
