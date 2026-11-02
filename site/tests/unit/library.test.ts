import { describe, expect, it } from 'vitest';
import { getLibraryResources, libraryCategories } from '../../src/lib/library';

describe('public library catalog', () => {
  const resources = getLibraryResources();

  it('publishes every catalog entry exactly once', () => {
    expect(resources).toHaveLength(49);
    expect(new Set(resources.map((resource) => resource.id)).size).toBe(49);
    expect(new Set(resources.map((resource) => resource.slug)).size).toBe(49);
  });

  it('assigns each resource to a visible category', () => {
    const knownCategories = new Set(libraryCategories.map((category) => category.id));
    expect(resources.every((resource) => knownCategories.has(resource.category.id))).toBe(true);
    expect(libraryCategories.every((category) => resources.some((resource) => resource.category.id === category.id))).toBe(true);
  });

  it('keeps user-facing context and source links on every card', () => {
    for (const resource of resources) {
      expect(resource.summary.length, resource.id).toBeGreaterThan(30);
      expect(resource.benefit.length, resource.id).toBeGreaterThan(30);
      expect(resource.caution.length, resource.id).toBeGreaterThan(20);
      if (resource.accessUrl) expect(resource.accessUrl, resource.id).toMatch(/^https?:\/\//u);
      else expect(['LIB-018', 'LIB-019', 'LIB-020', 'LIB-036']).toContain(resource.id);
      expect(resource.href, resource.id).toMatch(/^\/library\/[a-z0-9-]+\/$/u);
    }
  });

  it('does not expose Telegram links to book or pamphlet files without confirmed distribution rights', () => {
    const books = resources.filter((resource) => resource.category.id === 'books');
    expect(books.every((resource) => resource.telegramAlternatives.length === 0)).toBe(true);
    expect(books.every((resource) => !resource.accessUrl.startsWith('https://t.me/'))).toBe(true);
    expect(resources.find((resource) => resource.id === 'LIB-003')?.accessUrl).toBe('https://vk.com/elen_time');
  });

  it('does not publish unverified Diabet NEWS posts or the private group invitation', () => {
    for (const id of ['LIB-012', 'LIB-013', 'LIB-014', 'LIB-015', 'LIB-016', 'LIB-036']) {
      const resource = resources.find((item) => item.id === id)!;
      expect(resource.telegramPostUrl, id).toBe('');
      expect(resource.telegramAlternatives, id).toEqual([]);
      expect(resource.accessUrl, id).not.toMatch(/^https:\/\/t\.me\//u);
      expect(resource.rights, id).not.toContain('не подтверждены');
      expect(resource.rights, id).toContain(id === 'LIB-036' ? 'Ссылка на группу будет добавлена' : 'Ссылка на публикацию будет добавлена');
    }
    expect(resources.find((item) => item.id === 'LIB-036')?.accessUrl).toBe('');
  });

  it('exposes distinct Telegram alternatives for community resources', () => {
    const withTelegramAlternative = resources.filter((resource) => resource.telegramAlternatives.length > 0);
    expect(resources.find((resource) => resource.id === 'LIB-033')?.telegramAlternatives[0]?.url).toBe('https://t.me/juggluco');
    expect(withTelegramAlternative.length).toBeGreaterThan(0);
    expect(withTelegramAlternative.every((resource) => resource.telegramAlternatives.every((link) => link.url !== resource.accessUrl))).toBe(true);
  });
});
