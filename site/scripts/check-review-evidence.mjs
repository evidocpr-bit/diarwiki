import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFrontmatterValue, sha256Content, splitFrontmatter } from './review-markers.mjs';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const contentRoot = join(siteRoot, 'src', 'content', 'docs');
const recordsRoot = join(siteRoot, 'review-records');
const records = new Map();
const errors = [];

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (/\.mdx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}

function scalar(frontmatter, key) {
  const value = getFrontmatterValue(frontmatter, key);
  if (value === null || value === 'null') return null;
  return value.replace(/^(["'])(.*)\1$/u, '$2');
}

for (const name of readdirSync(recordsRoot).filter((item) => item.endsWith('.json'))) {
  try {
    const record = JSON.parse(readFileSync(join(recordsRoot, name), 'utf8'));
    if (!record.contentId || records.has(record.contentId)) throw new Error('contentId is missing or duplicated');
    records.set(record.contentId, record);
  } catch (error) {
    errors.push(`${name}: invalid review record (${error.message})`);
  }
}

const seenContentIds = new Set();
for (const path of walk(contentRoot)) {
  const source = readFileSync(path, 'utf8');
  const { frontmatter } = splitFrontmatter(source);
  const contentId = scalar(frontmatter, 'contentId');
  if (!contentId) continue;
  seenContentIds.add(contentId);
  const record = records.get(contentId);
  if (scalar(frontmatter, 'medicalReview') !== 'reviewed') {
    if (record) errors.push(`${contentId}: remove the review record or restore medicalReview: reviewed.`);
    continue;
  }
  if (!record) {
    errors.push(`${contentId}: reviewed content requires review-records/${contentId}.json.`);
    continue;
  }

  const expected = {
    contentPath: relative(contentRoot, path).replace(/\\/gu, '/'),
    contentHash: sha256Content(source),
    reviewerName: scalar(frontmatter, 'reviewedBy'),
    reviewerSpecialty: scalar(frontmatter, 'reviewerSpecialty'),
    reviewedAt: scalar(frontmatter, 'reviewedAt')?.slice(0, 10) ?? null,
    reviewerProfileUrl: scalar(frontmatter, 'reviewerProfileUrl'),
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((record[key] ?? null) !== value) errors.push(`${contentId}: review record field '${key}' does not match the article.`);
  }
  if (!record.evidenceRef || !record.evidenceType) errors.push(`${contentId}: evidenceRef and evidenceType are required; do not store the evidence itself in the public repository.`);
  if (record.approvedBy !== 'site-owner' || !/^\d{4}-\d{2}-\d{2}$/u.test(record.approvedAt ?? '')) {
    errors.push(`${contentId}: the record must identify site-owner approval and its date.`);
  }
}

for (const contentId of records.keys()) {
  if (!seenContentIds.has(contentId)) errors.push(`${contentId}: review record does not match any content item.`);
}

if (errors.length) {
  console.error(`Medical review evidence failures (${errors.length}):\n${errors.join('\n')}`);
  process.exit(1);
}

console.log(`Checked review evidence records for ${seenContentIds.size} content files.`);
