import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

test('first visit is not blocked by a disclaimer modal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.service-strip')).toContainText(/Не заменяет врача/i);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Диабет 1 типа');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Диабет 1 типа');
});

test('global search finds published content', async ({ page }) => {
  await page.goto('/search/');
  const assetResponse = await page.request.get('/pagefind/pagefind.js');
  const assetContentType = assetResponse.headers()['content-type'] ?? '';
  expect(assetResponse.ok(), `Pagefind asset HTTP ${assetResponse.status()} (${assetContentType}): ${(await assetResponse.text()).slice(0, 100)}`).toBeTruthy();
  expect(assetContentType, `Unexpected Pagefind content type: ${assetContentType}`).toContain('javascript');
  await page.getByLabel('Тема, вопрос или название устройства').fill('датчик');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.getByRole('link', { name: 'Что показывает датчик глюкозы' })).toBeVisible();
});

test('urgent page points directly to emergency services', async ({ page }) => {
  await page.goto('/urgent/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не ждите ответа на сайте');
  await expect(page.getByRole('link', { name: /Единый номер экстренных служб 112/ })).toHaveAttribute('href', 'tel:112');
  await expect(page.getByRole('link', { name: /Скорая медицинская помощь 103/ })).toHaveAttribute('href', 'tel:103');
});

test('Russian brand and Evidoc provenance are visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: 'ДиарВики', exact: true })).toBeVisible();
  await expect(page.locator('.footer-partner')).toContainText(/Экспертный партнёр/i);
  const evidocLink = page.locator('.footer-partner').getByRole('link', { name: 'Центр доказательной медицины «Эвидок»' });
  await expect(evidocLink).toBeVisible();
  await expect(evidocLink).toHaveAttribute('href', 'https://centrdocmed.ru/');
  await expect(page.locator('.footer-partner')).toContainText('могут рецензировать отдельные материалы');

  await page.goto('/about/');
  await expect(page.getByRole('heading', { name: 'Куратор и создатель проекта' })).toBeVisible();
  await expect(page.getByText(/Пономарев Степан Андреевич/)).toBeVisible();
  await expect(page.getByText(/Accu-Chek Combo/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Миссия' })).toBeVisible();
  await expect(page.getByText(/открытого диабет-сообщества/)).toBeVisible();
});

test('public pages do not show the former Latin brand', async ({ page }) => {
  for (const path of ['/', '/about/', '/knowledge/', '/tools/', '/contact/', '/legal/medical-disclaimer/']) {
    await page.goto(path);
    await expect(page.locator('body')).not.toContainText('DiarWiki');
    expect(await page.title()).not.toContain('DiarWiki');
  }
});

test('catalog filter and article route work', async ({ page }) => {
  await page.goto('/knowledge/');
  await page.getByLabel('Быстрый поиск по названиям и описаниям').fill('приём');
  await expect(page.getByText('2 материала', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Подготовить вопросы эндокринологу/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Подготовить вопросы эндокринологу');
  await expect(page.getByText('Материал редакции').first()).toBeVisible();
  await expect(page.getByText(/Врачебная проверка этой версии материала пока не проводилась/)).toBeVisible();
});

test('library separates resources and explains their limits', async ({ page }, testInfo) => {
  await page.goto('/library/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Что открывать и зачем');
  await expect(page.getByTestId('library-count')).toHaveText('49 из 49');
  await expect(page.locator('[data-category="books"][href*="t.me/"]')).toHaveCount(0);
  await page.screenshot({ path: `../output/playwright/library-${testInfo.project.name}.png`, fullPage: true });

  await page.getByRole('button', { name: /Приложения 8/ }).click();
  await expect(page.getByTestId('library-count')).toHaveText('8 из 49');
  await page.locator('.resource-row[href="/library/juggluco/"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Juggluco');
  await expect(page.getByRole('heading', { name: 'Чем полезен этот ресурс' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Что важно учесть' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Открыть в Google Play/ })).toBeVisible();
  await expect(page.getByTestId('resource-access')).toBeVisible();
  await page.screenshot({ path: `../output/playwright/library-juggluco-${testInfo.project.name}.png`, fullPage: true });
});

test('Telegram directory is searchable and keeps the closed teen contact private', async ({ page }, testInfo) => {
  const response = await page.goto('/knowledge/telegram-channels-diabetes/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Telegram-каналы и чаты о диабете');
  await expect(page.locator('[data-community-card]')).toHaveCount(95);
  await expect(page.locator('[data-community-count]')).toHaveText('95 из 95');
  await expect(page.locator('a[href=""]')).toHaveCount(0);
  await expect(page.getByText('Вход через модератора · ссылка скрыта до согласования')).toBeVisible();

  await page.getByLabel('Поиск по названию, теме или региону').fill('Хабаровск');
  await expect(page.locator('[data-community-count]')).toHaveText('1 из 95');
  await expect(page.getByRole('heading', { name: 'Хабаровск' })).toBeVisible();

  await page.getByLabel('Поиск по названию, теме или региону').fill('');
  await page.getByRole('button', { name: 'Мониторинги 11' }).click();
  await expect(page.locator('[data-community-count]')).toHaveText('11 из 95');
  await page.screenshot({ path: `../output/playwright/telegram-directory-${testInfo.project.name}.png`, fullPage: true });
});

test('sensor guide is published with sources and review status', async ({ page }, testInfo) => {
  const response = await page.goto('/knowledge/cgm-basics/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Что показывает датчик глюкозы');
  await expect(page.getByText('Материал редакции').first()).toBeVisible();
  await expect(page.getByText(/Врачебная проверка этой версии материала пока не проводилась/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Continuous Glucose Monitoring/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Поймите, где проходит измерение' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Схема слоёв кожи/ })).toBeVisible();
  await page.screenshot({ path: `test-results/diarwiki-cgm-${testInfo.project.name}.png`, fullPage: true });
});

test('start page routes readers to checked learning resources', async ({ page }, testInfo) => {
  const response = await page.goto('/start/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Где учиться дальше' })).toBeVisible();
  await expect(page.getByRole('link', { name: /ТЕРАПЕВТУМ/ })).toHaveAttribute('href', '/library/terapevtum/');
  await expect(page.getByRole('link', { name: /Сахарный человек/ })).toHaveAttribute('href', '/library/saharnyi-chelovek/');
  await expect(page.getByRole('link', { name: /Архив вебинаров Medtronic/ })).toHaveAttribute('href', '/library/medtronic-webinars-drive/');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../output/playwright/start-learning-${testInfo.project.name}.png`, fullPage: true });
});

test('sharing guide separates manufacturer followers, clinic reports, and community routes', async ({ page }, testInfo) => {
  const response = await page.goto('/knowledge/cgm-sharing/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Как данные датчика попадают к близким и врачу');
  await expect(page.getByRole('heading', { name: 'Как работают LibreLinkUp и LibreView' })).toBeVisible();
  await expect(page.getByText('CareLink Connect', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('EasyFollow', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Sharing Dexcom Data/ })).toBeVisible();
  await expect(page.getByText(/Врачебная проверка этой версии материала пока не проводилась/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../output/playwright/cgm-sharing-${testInfo.project.name}.png`, fullPage: true });
});

test('Juggluco comparison is published with primary sources and safety boundaries', async ({ page }, testInfo) => {
  const response = await page.goto('/knowledge/juggluco-juggluco-ng/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Juggluco и JugglucoNG: в чём разница');
  await expect(page.getByText(/В репозитории JugglucoNG прямо указан alpha-статус/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Juggluco documentation/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /JugglucoNG source code and releases/ })).toBeVisible();
  await expect(page.getByText(/Врачебная проверка этой версии материала пока не проводилась/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../output/playwright/juggluco-comparison-${testInfo.project.name}.png`, fullPage: true });
});

test('first CGM report package is readable, sourced, and fits the viewport', async ({ page }, testInfo) => {
  const articles = [
    {
      path: '/knowledge/cgm-report-statistics/',
      heading: 'Как читать отчёт CGM: TIR, GMI, CV и профиль AGP',
      evidence: 'Nightscout: отчёты, GVI и PGS',
      screenshot: 'cgm-report-statistics',
    },
    {
      path: '/knowledge/cgm-report-for-doctor/',
      heading: 'Как подготовить отчёт CGM к приёму эндокринолога',
      evidence: 'Nightscout: отчёты и доступ только для чтения',
      screenshot: 'cgm-report-for-doctor',
    },
    {
      path: '/knowledge/cgm-new-phone/',
      heading: 'Как перенести мониторинг глюкозы на новый телефон',
      evidence: 'Dexcom G7: перенос на новый телефон',
      screenshot: 'cgm-new-phone',
    },
  ];

  for (const article of articles) {
    const response = await page.goto(article.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(article.heading);
    await expect(page.getByRole('heading', { name: article.evidence })).toBeVisible();
    await expect(page.getByText(/Врачебная проверка этой версии материала пока не проводилась/)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../output/playwright/${article.screenshot}-${testInfo.project.name}.png`, fullPage: true });
  }

  await page.goto('/knowledge/cgm-new-phone/');
  await expect(page.getByText(/две отдельные паузы по 15 минут/)).toBeVisible();
  await expect(page.getByText(/Подождать ещё 15 минут/)).toBeVisible();
});

test('glucose converter computes locally in both directions', async ({ page }) => {
  await page.goto('/tools/glucose-units/');
  await page.getByLabel('Значение').fill('5,6');
  await page.getByRole('button', { name: 'Перевести' }).click();
  await expect(page.getByText('101 мг/дл', { exact: true })).toBeVisible();
  await page.getByLabel('мг/дл → ммоль/л').check();
  await page.getByLabel('Значение').fill('100');
  await page.getByRole('button', { name: 'Перевести' }).click();
  await expect(page.getByText('5,5 ммоль/л', { exact: true })).toBeVisible();
});

test('navigation has no empty destinations', async ({ page }) => {
  for (const path of ['/', '/start/', '/knowledge/', '/library/', '/library/juggluco/', '/knowledge/cgm-basics/', '/knowledge/cgm-no-readings/', '/knowledge/cgm-sharing/', '/knowledge/cgm-report-statistics/', '/knowledge/cgm-report-for-doctor/', '/knowledge/cgm-new-phone/', '/tools/glucose-units/', '/urgent/', '/search/', '/about/', '/legal/privacy/', '/missing-page/']) {
    const response = await page.goto(path);
    expect(response?.status(), path === '/missing-page/' ? path : undefined).toBe(path === '/missing-page/' ? 404 : 200);
  }
});

test('mobile home keeps key actions visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.folder').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/diarwiki-mobile-home.png', fullPage: true });
});

test('route cards fit the tablet viewport and remain clickable', async ({ page }) => {
  await page.setViewportSize({ width: 997, height: 700 });
  await page.goto('/');

  const routeLinks = page.locator('.folder');
  await expect(routeLinks).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (let index = 0; index < 4; index += 1) {
    await expect(routeLinks.nth(index)).toBeVisible();
    const box = await routeLinks.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(997);
  }

  await routeLinks.nth(1).click();
  await expect(page).toHaveURL(/\/knowledge\/cgm-basics\/$/);
});

test('folders animate on keyboard focus without blocking reduced motion', async ({ page }) => {
  await page.goto('/');
  const folder = page.locator('.folder').first();
  for (let tabCount = 0; tabCount < 24; tabCount += 1) {
    const hasFocus = await folder.evaluate((node) => node === document.activeElement);
    if (hasFocus) break;
    await page.keyboard.press('Tab');
  }
  await expect(folder).toBeFocused();
  await expect.poll(() => folder.locator('.folder-front').evaluate((node) => getComputedStyle(node).transform)).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => folder.locator('.folder-front').evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThan(.001);
});

test('blueprint system uses the specified palette, type roles, folders, and diagrams', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.folder')).toHaveCount(4);
  await expect(page.getByRole('img', { name: 'Кубик сахара', exact: true })).toBeVisible();
  const tokens = await page.evaluate(() => ({
    blue: getComputedStyle(document.documentElement).getPropertyValue('--dw-blue').trim(),
    display: getComputedStyle(document.querySelector('h1')!).fontFamily,
    text: getComputedStyle(document.body).fontFamily,
    mono: getComputedStyle(document.querySelector('.dw-label')!).fontFamily,
  }));
  expect(tokens.blue.toLowerCase()).toBe('#1d45d8');
  expect(tokens.display).toContain('Inter Tight');
  expect(tokens.text).toContain('Golos Text');
  expect(tokens.mono).toContain('JetBrains Mono');
});

test('blue surfaces keep readable link text before and after interaction', async ({ page }, testInfo) => {
  await page.goto('/');
  const quickLinks = page.getByTestId('home-hero').locator('a');
  for (const link of await quickLinks.all()) {
    await expect(link).toHaveCSS('color', 'rgb(255, 255, 255)');
    await link.hover();
    await expect(link).toHaveCSS('color', 'rgb(255, 255, 255)');
    await link.focus();
    await expect(link).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
  await page.getByTestId('home-hero').screenshot({ path: `../output/playwright/blueprint-hero-${testInfo.project.name}.png` });
  for (const folder of await page.locator('.folder').all()) {
    const title = folder.locator('.folder-title');
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
    await folder.hover();
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
    await folder.focus();
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(folder.locator('.folder-sheet')).toHaveCSS('color', 'rgb(11, 26, 68)');
  }
  const folder = page.locator('.folder').nth(1);
  await folder.hover();
  await expect.poll(() => folder.locator('.folder-sheet').evaluate((node) => getComputedStyle(node).transform)).toContain('-44');
  await folder.screenshot({ path: `../output/playwright/blueprint-folder-hover-${testInfo.project.name}.png` });
});

test('key pages have no serious automated accessibility violations', async ({ page }) => {
  for (const path of ['/', '/knowledge/what-is-diabetes/', '/knowledge/cgm-basics/', '/library/', '/library/juggluco/', '/tools/glucose-units/']) {
    await page.goto(path);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: () => Promise<{ violations: Array<{ impact: string | null; id: string }> }> } }).axe;
      const result = await axe.run();
      return result.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious');
    });
    expect(violations, `${path}: ${JSON.stringify(violations)}`).toEqual([]);
  }
});
