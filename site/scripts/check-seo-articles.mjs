import { decodeEntities, visibleWordCount } from './html-text.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const routes = [
  '/knowledge/what-is-diabetes/',
  '/knowledge/after-diagnosis/',
  '/knowledge/prepare-for-appointment/',
  '/knowledge/glucometer-basics/',
  '/knowledge/insulin-types/',
  '/knowledge/cgm-report-statistics/',
  '/knowledge/cgm-report-for-doctor/',
  '/knowledge/cgm-new-phone/',
];
const failures = [];
const report = [];

const decode = (value = '') => decodeEntities(value).trim();

function getMeta(html, name) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
    if (key !== name) continue;
    return decode(tag.match(/content=["']([^"']*)["']/i)?.[1]);
  }
  return '';
}

function getCanonical(html) {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']canonical["']/i.test(tag)) continue;
    return decode(tag.match(/href=["']([^"']+)["']/i)?.[1]);
  }
  return '';
}


const sitemapText = readdirSync(dist)
  .filter((name) => /^sitemap-\d+\.xml$/u.test(name))
  .map((name) => readFileSync(new URL(name, dist), 'utf8'))
  .join('\n');

const titles = new Map();
const descriptions = new Map();

for (const route of routes) {
  const html = readFileSync(new URL(`.${route}index.html`, dist), 'utf8');
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const description = getMeta(html, 'description');
  const canonical = getCanonical(html);
  const robots = getMeta(html, 'robots');
  const h1Count = [...html.matchAll(/<h1\b/gi)].length;
  const h2Count = [...html.matchAll(/<h2\b/gi)].length;
  const words = visibleWordCount(html);
  // An empty alt is correct for purely decorative images such as the hidden
  // Yandex Metrika pixel. Fail only when the attribute itself is missing.
  const emptyAlts = [...html.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) => !/alt=["'][^"']*["']/i.test(tag)).length;
  const schemas = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => {
      try { return JSON.parse(match[1]); } catch { return null; }
    })
    .filter(Boolean);
  const hasMedicalSchema = schemas.some((value) => value['@type'] === 'MedicalWebPage');
  const expectedCanonical = `https://diarwiki.ru${route}`;

  const checks = [
    ['title 35–75 знаков', title.length >= 35 && title.length <= 75, `${title.length}: ${title}`],
    ['description 110–180 знаков', description.length >= 110 && description.length <= 180, `${description.length}: ${description}`],
    ['самоканонический URL', canonical === expectedCanonical, canonical],
    ['страница индексируема', !/\b(?:noindex|none)\b/i.test(robots), robots || 'robots не запрещает индексацию'],
    ['один H1', h1Count === 1, String(h1Count)],
    ['не менее пяти H2', h2Count >= 5, String(h2Count)],
    ['MedicalWebPage JSON-LD', hasMedicalSchema, hasMedicalSchema ? 'есть' : 'нет'],
    ['Open Graph title', Boolean(getMeta(html, 'og:title')), getMeta(html, 'og:title') || 'нет'],
    ['Open Graph description', Boolean(getMeta(html, 'og:description')), getMeta(html, 'og:description') || 'нет'],
    ['alt у всех изображений', emptyAlts === 0, `${emptyAlts} без alt`],
    ['длинный материал', words >= 1400, `${words} слов`],
    ['есть в sitemap', sitemapText.includes(`<loc>${expectedCanonical}</loc>`), expectedCanonical],
  ];

  for (const [label, ok, detail] of checks) {
    if (!ok) failures.push(`${route}: ${label} — ${detail}`);
  }
  if (titles.has(title)) failures.push(`${route}: duplicate title with ${titles.get(title)}`);
  else titles.set(title, route);
  if (descriptions.has(description)) failures.push(`${route}: duplicate description with ${descriptions.get(description)}`);
  else descriptions.set(description, route);
  report.push(`${route} — ${checks.filter(([, ok]) => ok).length}/${checks.length} проверок, ${words} слов`);
}

console.log(report.join('\n'));
if (failures.length) {
  console.error(`SEO failures (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`SEO audit passed for ${routes.length} production articles.`);
