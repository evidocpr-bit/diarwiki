import { describe, expect, it } from 'vitest';
import { getFrontmatterValue, sha256Content, splitFrontmatter } from '../../scripts/review-markers.mjs';

describe('medical review markers', () => {
  it('splits frontmatter from the reviewed article body', () => {
    expect(splitFrontmatter('---\ntitle: Test\n---\nBody').body).toBe('Body');
    expect(getFrontmatterValue('medicalReview: reviewed\nreviewedBy: null', 'medicalReview')).toBe('reviewed');
  });

  it('changes the review hash when the article changes, but not when review metadata is recorded', () => {
    const first = sha256Content('---\ntitle: Test\n---\nBody');
    const edited = sha256Content('---\ntitle: Test\n---\nEdited body');
    expect(first).toMatch(/^[a-f\d]{64}$/u);
    expect(edited).not.toBe(first);

    const pending = '---\ntitle: Test\nmedicalReview: pending\nreviewedBy: null\nreviewerSpecialty: null\nreviewedAt: null\nreviewedContentHash: null\n---\nBody';
    const approved = '---\ntitle: Test\nmedicalReview: reviewed\nreviewedBy: Dr Example\nreviewerSpecialty: Endocrinology\nreviewedAt: 2026-10-20\nreviewedContentHash: a'.padEnd(64, 'a') + '\n---\nBody';
    expect(sha256Content(approved)).toBe(sha256Content(pending));

    const beforeReviewFields = '---\ntitle: Test\ncontentId: DW-TEST\nmedicalReview: pending\nreviewedBy: null\nreviewedAt: null\n---\nBody';
    const afterReviewFields = '---\ntitle: Test\ncontentId: DW-TEST\nmedicalReview: reviewed\nreviewedBy: Dr Example\nreviewerSpecialty: Endocrinology\nreviewerProfileUrl: null\nreviewedAt: 2026-10-20\nreviewedContentHash: a'.padEnd(64, 'a') + '\n---\nBody';
    expect(sha256Content(afterReviewFields)).toBe(sha256Content(beforeReviewFields));
  });

  it('normalizes Windows CRLF and Unix LF before hashing', () => {
    const unix = '---\ntitle: Test\n---\nBody\nSecond line\n';
    const windows = unix.replace(/\n/gu, '\r\n');
    expect(sha256Content(windows)).toBe(sha256Content(unix));
  });
});
