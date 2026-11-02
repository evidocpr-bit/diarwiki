import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (extname(entry.name) === '.html') files.push(path);
  }
}

walk(root);
const failures = [];

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const links = [...html.matchAll(/href=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const href of links) {
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    if (/(?:\?v=|[?&]utm_)/i.test(href)) {
      failures.push(`${relative(root, file)} -> forbidden version or tracking parameter: ${href}`);
      continue;
    }
    const clean = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    if (clean === '/') continue;
    const diskPath = clean.endsWith('/')
      ? join(root, clean.slice(1), 'index.html')
      : join(root, clean.slice(1));
    if (!existsSync(diskPath)) failures.push(`${relative(root, file)} -> ${href}`);
  }
}

if (failures.length) {
  console.error(`Broken internal links (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Checked internal links in ${files.length} HTML files.`);
