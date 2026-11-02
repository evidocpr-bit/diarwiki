import { describe, expect, it } from 'vitest';
import { mainNavigation, siteIdentity, siteRoutes } from '../../src/config/site';

describe('site architecture contract', () => {
  it('uses the approved Russian identity and canonical origin', () => {
    expect(siteIdentity.name).toBe('ДиарВики');
    expect(siteIdentity.origin).toBe('https://diarwiki.ru');
    expect(siteIdentity.editorEmail).toBe('info@diarwiki.ru');
    expect(siteIdentity.owner.status).toBe('физическое лицо');
    expect(siteIdentity.owner.location).toContain('г. Хабаровск');
    expect(siteIdentity.evidoc.url).toBe('https://centrdocmed.ru/');
  });

  it('keeps public routes unique and free of release query parameters', () => {
    const hrefs = siteRoutes.map((route) => route.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.filter((href) => href === '/about/')).toHaveLength(1);
    expect(hrefs.every((href) => !href.includes('?'))).toBe(true);
  });

  it('shows the single about route once in primary navigation', () => {
    expect(mainNavigation.filter((route) => route.href === '/about/')).toHaveLength(1);
  });
});
