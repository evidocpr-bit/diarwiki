import { createHash } from 'node:crypto';

export function getFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'mu'));
  return match?.[1] ?? null;
}

export function splitFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u);
  if (!match) throw new Error('Expected YAML frontmatter followed by article content.');
  return { frontmatter: match[1], body: match[2] };
}

export function sha256Content(source) {
  const normalizedSource = source.replace(/\r\n/gu, '\n');
  const { frontmatter, body } = splitFrontmatter(normalizedSource);
  const reviewMetadataLine = /^(medicalReview|reviewedBy|reviewerSpecialty|reviewerProfileUrl|reviewedAt|reviewedContentHash):\s*.*$/u;
  const normalizedFrontmatter = frontmatter
    .split(/\r?\n/u)
    .filter((line) => !reviewMetadataLine.test(line))
    .join('\n');
  return createHash('sha256').update(`${normalizedFrontmatter}\n${body}`, 'utf8').digest('hex');
}
