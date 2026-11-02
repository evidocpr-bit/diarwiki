import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8');
const releaseCheck = readFileSync(new URL('../../deploy/verify-release.sh', import.meta.url), 'utf8');
const activateRelease = readFileSync(new URL('../../deploy/activate-release.sh', import.meta.url), 'utf8');
const reviewEvidenceCheck = readFileSync(new URL('../../scripts/check-review-evidence.mjs', import.meta.url), 'utf8');
const articleMetadata = readFileSync(new URL('../../src/components/articles/ArticleMetadata.astro', import.meta.url), 'utf8');
const baseLayout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
const starlightHead = readFileSync(new URL('../../src/components/starlight/CustomHead.astro', import.meta.url), 'utf8');
const starlightFooter = readFileSync(new URL('../../src/components/starlight/CustomFooter.astro', import.meta.url), 'utf8');
const metrikaHead = readFileSync(new URL('../../src/components/analytics/YandexMetrikaHead.astro', import.meta.url), 'utf8');
const metrikaNoScript = readFileSync(new URL('../../src/components/analytics/YandexMetrikaNoScript.astro', import.meta.url), 'utf8');

describe('deployment security contract', () => {
  it('allows Pagefind WebAssembly and workers under the site CSP', () => {
    expect(caddyfile).toContain("'wasm-unsafe-eval'");
    expect(caddyfile).toContain("worker-src 'self' blob:");
  });

  it('does not give stable Pagefind filenames a year-long immutable cache', () => {
    expect(caddyfile).toMatch(/@immutable path \/_astro\/\*/u);
    expect(caddyfile).not.toMatch(/@immutable path[^\n]*\/pagefind\/\*/u);
    expect(caddyfile).toMatch(/@pagefind path \/pagefind\/\*[\s\S]*?no-cache, max-age=0, must-revalidate/u);
    expect(releaseCheck).toContain("fetch '/pagefind/pagefind.js' pagefind");
  });

  it('requires a version-matched evidence record for reviewed content', () => {
    expect(reviewEvidenceCheck).toContain('review-records/${contentId}.json');
    expect(reviewEvidenceCheck).toContain("record.approvedBy !== 'site-owner'");
  });

  it('binds activation and live verification to the immutable CMS snapshot', () => {
    expect(activateRelease).toContain('verify-release-manifest.mjs');
    expect(activateRelease).toContain('release-manifest.json');
    expect(releaseCheck).toContain('sourceSnapshotSha256');
    expect(releaseCheck).toContain('EXPECTED_SNAPSHOT_SHA256');
  });

  it('uses Schema.org medical-page review properties without the unsupported dateReviewed field', () => {
    expect(articleMetadata).toContain("'@type': 'MedicalWebPage'");
    expect(articleMetadata).toContain('lastReviewed:');
    expect(articleMetadata).not.toContain('dateReviewed:');
  });

  it('loads Yandex Metrika on both page layout systems', () => {
    expect(metrikaHead).toContain("ym(113733279, 'init'");
    expect(metrikaNoScript).toContain('mc.yandex.ru/watch/113733279');
    expect(baseLayout).toContain('<YandexMetrikaHead />');
    expect(baseLayout).toContain('<YandexMetrikaNoScript />');
    expect(starlightHead).toContain('<YandexMetrikaHead />');
    expect(starlightFooter).toContain('<YandexMetrikaNoScript />');
    expect(releaseCheck).toContain('mc.yandex.ru/metrika/tag.js?id=113733279');
  });

  it('allows Yandex Metrika and Webvisor through the production CSP', () => {
    expect(caddyfile).toMatch(/script-src[^;]*https:\/\/mc\.yandex\.ru[^;]*https:\/\/yastatic\.net/u);
    expect(caddyfile).toMatch(/connect-src[^;]*https:\/\/mc\.yandex\.ru/u);
    expect(caddyfile).toMatch(/frame-src[^;]*blob:[^;]*https:\/\/mc\.yandex\.ru/u);
  });
});
