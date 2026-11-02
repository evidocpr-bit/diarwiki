import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256Content } from './review-markers.mjs';

const relativePath = process.argv.slice(2).find((argument) => argument !== '--');
if (!relativePath) {
  console.error('Usage: pnpm review:hash -- src/content/docs/knowledge/article.mdx');
  process.exit(2);
}

console.log(sha256Content(readFileSync(resolve(process.cwd(), relativePath), 'utf8')));
