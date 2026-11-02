import { describe, expect, it } from 'vitest';
import { getTelegramCategoryCounts, getTelegramCommunities, telegramCategoryOrder } from '../../src/lib/telegramCommunities';

describe('Telegram community directory', () => {
  const communities = getTelegramCommunities();

  it('loads all registry entries once', () => {
    expect(communities).toHaveLength(95);
    expect(new Set(communities.map((item) => item.id)).size).toBe(95);
    expect(new Set(communities.map((item) => item.slug)).size).toBe(95);
  });

  it('keeps every entry in a visible section with context', () => {
    expect(getTelegramCategoryCounts().map(({ category }) => category)).toEqual([...telegramCategoryOrder]);
    expect(getTelegramCategoryCounts().reduce((total, row) => total + row.count, 0)).toBe(95);
    expect(getTelegramCategoryCounts().find(({ category }) => category === 'Региональные сообщества')?.count).toBe(45);
    for (const item of communities) {
      expect(item.description.length, item.id).toBeGreaterThan(20);
      expect(item.editorialNote.length, item.id).toBeGreaterThan(20);
      if (item.canLink) expect(item.url, item.id).toMatch(/^https:\/\/t\.me\//u);
    }
  });

  it('does not expose the moderator contact for the closed teen chat', () => {
    const closed = communities.filter((item) => !item.canLink);
    expect(closed.length).toBeGreaterThan(1);
    expect(closed.every((item) => !item.url)).toBe(true);
    expect(closed[0]?.id).toBe('TG-006');
    expect(closed[0]?.name).toBe('Закрытый чат подростков');
  });
});
