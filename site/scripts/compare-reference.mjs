// Сравнение сайта с эталоном «Blueprint».
// Положить в site/scripts/compare-reference.mjs, эталон — в site/design-reference/.
// Запуск: сначала `pnpm build && pnpm preview --host 127.0.0.1 --port 4322`,
// затем во втором окне: `node scripts/compare-reference.mjs`
// Результат: site/test-results/compare/<страница>-<ширина>-site.png и -reference.png.
// Открыть парами и сравнить: сетка, отступы, шрифты, цвета, линии, состояния.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.env.SITE_URL ?? 'http://127.0.0.1:4322';
const refDir = resolve('design-reference');
const out = resolve('test-results/compare');
mkdirSync(out, { recursive: true });

const pages = [
  { name: 'home', site: '/', ref: 'main.html' },
  { name: 'article', site: '/knowledge/cgm-basics/', ref: 'article.html' },
  { name: 'library', site: '/library/', ref: 'library.html' },
];
const widths = [
  { w: 1440, h: 900, scale: 1 },
  { w: 390, h: 844, scale: 2 },
];

const browser = await chromium.launch();
for (const { w, h, scale } of widths) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const page = await context.newPage();
  for (const p of pages) {
    await page.goto(base + p.site, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.warn(`! ${p.name} @${w}: есть горизонтальная прокрутка`);
    await page.screenshot({ path: `${out}/${p.name}-${w}-site.png`, fullPage: true });

    await page.goto(pathToFileURL(resolve(refDir, p.ref)).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/${p.name}-${w}-reference.png`, fullPage: true });
    console.log(`✓ ${p.name} @${w}`);
  }
  await context.close();
}
await browser.close();
console.log(`Готово: ${out}`);
