import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFrontmatterValue, sha256Content, splitFrontmatter } from './review-markers.mjs';

const contentRoot = fileURLToPath(new URL('../src/content/docs/', import.meta.url));
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.mdx?$/u.test(entry.name)) files.push(path);
  }
}

walk(contentRoot);
const errors = [];

for (const path of files) {
  const source = readFileSync(path, 'utf8');
  const { frontmatter } = splitFrontmatter(source);
  if (getFrontmatterValue(frontmatter, 'medicalReview') !== 'reviewed') continue;

  const relativePath = relative(contentRoot, path);
  const recordedHash = getFrontmatterValue(frontmatter, 'reviewedContentHash')?.replace(/["']/gu, '');
  const actualHash = sha256Content(source);
  if (!recordedHash || recordedHash.toLowerCase() !== actualHash) {
    errors.push(`${relativePath}: reviewedContentHash is missing or stale. Set medicalReview to pending until the edited version is reviewed again.`);
  }
}

if (errors.length) {
  console.error(`Medical review marker failures (${errors.length}):\n${errors.join('\n')}`);
  process.exit(1);
}

console.log(`Checked version-bound medical review markers in ${files.length} content files.`);
