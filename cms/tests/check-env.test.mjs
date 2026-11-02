import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatProblems,
  parseEnv,
  validateEnvironment,
} from '../scripts/check-env.mjs';

const baseEnvironment = {
  APP_ENV: 'production',
  PUBLIC_URL: 'https://cms.diarwiki.ru',
  DIRECTUS_IMAGE: 'directus/directus:12.5.0',
  POSTGRES_IMAGE: 'postgres:17-alpine',
  DIRECTUS_SECRET: 'd'.repeat(64),
  ADMIN_EMAIL: 'owner@diarwiki.ru',
  ADMIN_PASSWORD: 'A-strong-owner-password-2026!',
  DB_CLIENT: 'pg',
  DB_HOST: 'postgres',
  DB_PORT: '5432',
  DB_DATABASE: 'diarwiki_cms',
  DB_USER: 'diarwiki_cms',
  DB_PASSWORD: 'A-strong-database-password-2026!',
  DIRECTUS_LICENSE_KEY: 'oig_test_key_for_contract_validation',
  SESSION_COOKIE_SECURE: 'true',
  HSTS_ENABLED: 'true',
  EMAIL_TRANSPORT: 'smtp',
  EMAIL_FROM: 'DiarWiki CMS <cms@diarwiki.ru>',
  EMAIL_SMTP_HOST: 'smtp.example.test',
  EMAIL_SMTP_PORT: '587',
  EMAIL_SMTP_USER: 'cms@diarwiki.ru',
  EMAIL_SMTP_PASSWORD: 'A-strong-smtp-password-2026!',
};

test('parseEnv reads comments, export syntax, quotes, and equals signs', () => {
  const parsed = parseEnv(`
    # comment
    export APP_ENV=development
    PUBLIC_URL="http://127.0.0.1:8055"
    TOKEN='value=with=equals'
    EMPTY=
  `);

  assert.deepEqual(parsed, {
    APP_ENV: 'development',
    PUBLIC_URL: 'http://127.0.0.1:8055',
    TOKEN: 'value=with=equals',
    EMPTY: '',
  });
});

test('the tracked example accepts explicit placeholders and an empty license key', () => {
  const result = validateEnvironment({
    APP_ENV: 'development',
    PUBLIC_URL: 'http://127.0.0.1:8055',
    DIRECTUS_IMAGE: 'directus/directus:12.5.0',
    POSTGRES_IMAGE: 'postgres:17-alpine',
    DIRECTUS_SECRET: 'CHANGE_ME_GENERATE_WITH_SCRIPT',
    ADMIN_EMAIL: 'owner@example.invalid',
    ADMIN_PASSWORD: 'CHANGE_ME_OWNER_PASSWORD',
    DB_CLIENT: 'pg',
    DB_HOST: 'postgres',
    DB_PORT: '5432',
    DB_DATABASE: 'diarwiki_cms',
    DB_USER: 'diarwiki_cms',
    DB_PASSWORD: 'CHANGE_ME_DATABASE_PASSWORD',
    DIRECTUS_LICENSE_KEY: '',
    SESSION_COOKIE_SECURE: 'false',
    HSTS_ENABLED: 'false',
    EMAIL_TRANSPORT: 'smtp',
    EMAIL_FROM: 'DiarWiki CMS <cms@example.invalid>',
    EMAIL_SMTP_HOST: 'smtp.example.invalid',
    EMAIL_SMTP_PORT: '587',
    EMAIL_SMTP_USER: 'cms@example.invalid',
    EMAIL_SMTP_PASSWORD: 'CHANGE_ME_SMTP_PASSWORD',
  }, { example: true });

  assert.deepEqual(result.problems, []);
});

test('the tracked example rejects values that look like real secrets', () => {
  const result = validateEnvironment({
    ...baseEnvironment,
    APP_ENV: 'development',
    PUBLIC_URL: 'http://127.0.0.1:8055',
    DIRECTUS_LICENSE_KEY: '',
    SESSION_COOKIE_SECURE: 'false',
    HSTS_ENABLED: 'false',
  }, { example: true });

  assert.ok(result.problems.some((problem) =>
    problem.key === 'DIRECTUS_SECRET' && problem.code === 'example_contains_secret'));
  assert.ok(result.problems.some((problem) =>
    problem.key === 'ADMIN_PASSWORD' && problem.code === 'example_contains_secret'));
});

test('production configuration passes with pinned images and non-placeholder secrets', () => {
  const result = validateEnvironment(baseEnvironment);
  assert.deepEqual(result.problems, []);
});

test('production requires a Directus license key for the selected permission model', () => {
  const result = validateEnvironment({
    ...baseEnvironment,
    DIRECTUS_LICENSE_KEY: '',
  });

  assert.ok(result.problems.some((problem) =>
    problem.key === 'DIRECTUS_LICENSE_KEY' && problem.code === 'required_in_production'));
});

test('production rejects a placeholder Directus license key', () => {
  const result = validateEnvironment({
    ...baseEnvironment,
    DIRECTUS_LICENSE_KEY: 'CHANGE_ME_LICENSE_KEY',
  });

  assert.ok(result.problems.some((problem) =>
    problem.key === 'DIRECTUS_LICENSE_KEY' && problem.code === 'placeholder'));
});

test('development may start without a license key and SMTP credentials', () => {
  const result = validateEnvironment({
    ...baseEnvironment,
    APP_ENV: 'development',
    PUBLIC_URL: 'http://127.0.0.1:8055',
    DIRECTUS_LICENSE_KEY: '',
    SESSION_COOKIE_SECURE: 'false',
    HSTS_ENABLED: 'false',
    EMAIL_SMTP_HOST: '',
    EMAIL_SMTP_USER: '',
    EMAIL_SMTP_PASSWORD: '',
  });

  assert.deepEqual(result.problems, []);
});

test('development still requires the Directus, owner, and database secrets', () => {
  const result = validateEnvironment({
    ...baseEnvironment,
    APP_ENV: 'development',
    PUBLIC_URL: 'http://127.0.0.1:8055',
    DIRECTUS_SECRET: '',
    ADMIN_PASSWORD: '',
    DB_PASSWORD: '',
    DIRECTUS_LICENSE_KEY: '',
    SESSION_COOKIE_SECURE: 'false',
    HSTS_ENABLED: 'false',
    EMAIL_SMTP_HOST: '',
    EMAIL_SMTP_USER: '',
    EMAIL_SMTP_PASSWORD: '',
  });

  for (const key of ['DIRECTUS_SECRET', 'ADMIN_PASSWORD', 'DB_PASSWORD']) {
    assert.ok(result.problems.some((problem) => problem.key === key && problem.code === 'missing'));
  }
});

test('production rejects placeholders, short secrets, floating images, and HTTP URLs', () => {
  const result = validateEnvironment({
    ...baseEnvironment,
    PUBLIC_URL: 'http://cms.diarwiki.ru',
    DIRECTUS_IMAGE: 'directus/directus:latest',
    POSTGRES_IMAGE: 'postgres:latest',
    DIRECTUS_SECRET: 'short',
    ADMIN_PASSWORD: 'CHANGE_ME_OWNER_PASSWORD',
    SESSION_COOKIE_SECURE: 'false',
    HSTS_ENABLED: 'false',
  });

  const codes = new Set(result.problems.map(({ code }) => code));
  assert.ok(codes.has('https_required'));
  assert.ok(codes.has('image_not_pinned'));
  assert.ok(codes.has('too_short'));
  assert.ok(codes.has('placeholder'));
  assert.ok(codes.has('secure_cookie_required'));
  assert.ok(codes.has('hsts_required'));
});

test('formatProblems never includes secret values', () => {
  const secret = 'must-never-appear-in-output';
  const result = validateEnvironment({
    ...baseEnvironment,
    DIRECTUS_SECRET: secret,
    ADMIN_PASSWORD: secret,
    DB_PASSWORD: secret,
  }, { example: true });
  const formatted = formatProblems(result.problems);

  assert.doesNotMatch(formatted, /must-never-appear-in-output/u);
  assert.match(formatted, /DIRECTUS_SECRET/u);
});
