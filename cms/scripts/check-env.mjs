import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_KEYS = [
  'APP_ENV',
  'PUBLIC_URL',
  'DIRECTUS_IMAGE',
  'POSTGRES_IMAGE',
  'DIRECTUS_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'DB_CLIENT',
  'DB_HOST',
  'DB_PORT',
  'DB_DATABASE',
  'DB_USER',
  'DB_PASSWORD',
  'DIRECTUS_LICENSE_KEY',
  'SESSION_COOKIE_SECURE',
  'HSTS_ENABLED',
  'EMAIL_TRANSPORT',
  'EMAIL_FROM',
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASSWORD',
];

const SECRET_KEYS = [
  'DIRECTUS_SECRET',
  'ADMIN_PASSWORD',
  'DB_PASSWORD',
  'DIRECTUS_LICENSE_KEY',
  'EMAIL_SMTP_PASSWORD',
];

const SECRET_MIN_LENGTH = new Map([
  ['DIRECTUS_SECRET', 32],
  ['ADMIN_PASSWORD', 16],
  ['DB_PASSWORD', 16],
  ['EMAIL_SMTP_PASSWORD', 16],
]);

const ALWAYS_REQUIRED_SECRETS = [
  'DIRECTUS_SECRET',
  'ADMIN_PASSWORD',
  'DB_PASSWORD',
];

const PLACEHOLDER_PATTERN = /(?:change[_ -]?me|replace[_ -]?me|example|placeholder|generate[_ -]?with)/iu;

const MESSAGES = {
  invalid_app_env: 'допустимы только development, staging или production',
  invalid_boolean: 'допустимы только true или false',
  invalid_db_client: 'для CMS должен использоваться PostgreSQL (pg)',
  invalid_email: 'укажите корректный адрес электронной почты',
  invalid_port: 'порт должен быть целым числом от 1 до 65535',
  invalid_url: 'укажите абсолютный URL с протоколом http или https',
  example_contains_secret: 'шаблон не должен содержать значение, похожее на настоящий секрет',
  https_required: 'в production требуется HTTPS',
  hsts_required: 'в production HSTS должен быть включён',
  image_not_pinned: 'образ должен иметь явный тег и не может использовать latest',
  missing: 'обязательная переменная отсутствует',
  placeholder: 'замените шаблонное значение настоящим секретом',
  required_in_production: 'переменная обязательна в production',
  secure_cookie_required: 'в production защищённые cookies должны быть включены',
  too_short: 'значение не соответствует минимальной длине',
};

export function parseEnv(source) {
  const result = {};

  for (const rawLine of source.split(/\r?\n/u)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function addProblem(problems, key, code) {
  if (!problems.some((problem) => problem.key === key && problem.code === code)) {
    problems.push({ key, code, message: MESSAGES[code] });
  }
}

function isPinnedImage(value, kind) {
  if (!value || !value.includes(':') || /:latest$/iu.test(value)) return false;
  if (kind === 'directus') return /^directus\/directus:\d+\.\d+\.\d+$/u.test(value);
  return /^postgres:\d+(?:\.\d+){0,2}(?:-[a-z\d.-]+)?$/iu.test(value);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function isValidPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function validateEnvironment(environment, options = {}) {
  const { example = false } = options;
  const problems = [];

  for (const key of REQUIRED_KEYS) {
    if (!(key in environment)) addProblem(problems, key, 'missing');
  }

  const appEnv = environment.APP_ENV;
  if (appEnv && !['development', 'staging', 'production'].includes(appEnv)) {
    addProblem(problems, 'APP_ENV', 'invalid_app_env');
  }

  if (environment.PUBLIC_URL && !isValidUrl(environment.PUBLIC_URL)) {
    addProblem(problems, 'PUBLIC_URL', 'invalid_url');
  } else if (!example && appEnv === 'production' && !environment.PUBLIC_URL?.startsWith('https://')) {
    addProblem(problems, 'PUBLIC_URL', 'https_required');
  }

  if (environment.DIRECTUS_IMAGE && !isPinnedImage(environment.DIRECTUS_IMAGE, 'directus')) {
    addProblem(problems, 'DIRECTUS_IMAGE', 'image_not_pinned');
  }
  if (environment.POSTGRES_IMAGE && !isPinnedImage(environment.POSTGRES_IMAGE, 'postgres')) {
    addProblem(problems, 'POSTGRES_IMAGE', 'image_not_pinned');
  }

  if (environment.DB_CLIENT && environment.DB_CLIENT !== 'pg') {
    addProblem(problems, 'DB_CLIENT', 'invalid_db_client');
  }
  if (environment.DB_PORT && !isValidPort(environment.DB_PORT)) {
    addProblem(problems, 'DB_PORT', 'invalid_port');
  }
  if (environment.EMAIL_SMTP_PORT && !isValidPort(environment.EMAIL_SMTP_PORT)) {
    addProblem(problems, 'EMAIL_SMTP_PORT', 'invalid_port');
  }

  if (environment.ADMIN_EMAIL && !isValidEmail(environment.ADMIN_EMAIL)) {
    addProblem(problems, 'ADMIN_EMAIL', 'invalid_email');
  }

  for (const key of ['SESSION_COOKIE_SECURE', 'HSTS_ENABLED']) {
    if (environment[key] && !['true', 'false'].includes(environment[key])) {
      addProblem(problems, key, 'invalid_boolean');
    }
  }

  if (example) {
    for (const key of SECRET_KEYS) {
      const value = environment[key] ?? '';
      if (!value && key === 'DIRECTUS_LICENSE_KEY') continue;
      if (!PLACEHOLDER_PATTERN.test(value)) {
        addProblem(problems, key, 'example_contains_secret');
      }
    }
    return { problems };
  }

  for (const key of ALWAYS_REQUIRED_SECRETS) {
    if (!environment[key]) addProblem(problems, key, 'missing');
  }

  for (const key of SECRET_KEYS) {
    const value = environment[key] ?? '';
    if (value && PLACEHOLDER_PATTERN.test(value)) addProblem(problems, key, 'placeholder');
  }

  for (const [key, minimum] of SECRET_MIN_LENGTH) {
    const value = environment[key] ?? '';
    if (value && value.length < minimum) addProblem(problems, key, 'too_short');
  }

  if (appEnv === 'production') {
    const productionKeys = [
      'DIRECTUS_LICENSE_KEY',
      'EMAIL_SMTP_HOST',
      'EMAIL_SMTP_USER',
      'EMAIL_SMTP_PASSWORD',
    ];
    for (const key of productionKeys) {
      if (!environment[key]) addProblem(problems, key, 'required_in_production');
    }
    if (environment.SESSION_COOKIE_SECURE !== 'true') {
      addProblem(problems, 'SESSION_COOKIE_SECURE', 'secure_cookie_required');
    }
    if (environment.HSTS_ENABLED !== 'true') {
      addProblem(problems, 'HSTS_ENABLED', 'hsts_required');
    }
  }

  return { problems };
}

export function formatProblems(problems) {
  return problems
    .map(({ key, message }) => `- ${key}: ${message}`)
    .join('\n');
}

function readArguments(argv) {
  const result = { example: false, envPath: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--example') {
      result.example = true;
    } else if (argument === '--env') {
      result.envPath = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Неизвестный аргумент: ${argument}`);
    }
  }
  if (!result.envPath) throw new Error('Укажите путь: --env <файл>');
  return result;
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const environment = parseEnv(await readFile(options.envPath, 'utf8'));
  const result = validateEnvironment(environment, { example: options.example });

  if (result.problems.length > 0) {
    console.error('Конфигурация CMS не прошла проверку:');
    console.error(formatProblems(result.problems));
    process.exitCode = 1;
    return;
  }

  console.log(options.example
    ? 'Шаблон окружения CMS безопасен и содержит все обязательные переменные.'
    : 'Конфигурация окружения CMS прошла проверку.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
