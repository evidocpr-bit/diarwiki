import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_DIRECTUS_MAPPINGS = new Map([
  ['SECRET', 'DIRECTUS_SECRET'],
  ['PUBLIC_URL', 'PUBLIC_URL'],
  ['ADMIN_EMAIL', 'ADMIN_EMAIL'],
  ['ADMIN_PASSWORD', 'ADMIN_PASSWORD'],
  ['DB_CLIENT', 'DB_CLIENT'],
  ['DB_HOST', 'DB_HOST'],
  ['DB_PORT', 'DB_PORT'],
  ['DB_DATABASE', 'DB_DATABASE'],
  ['DB_USER', 'DB_USER'],
  ['DB_PASSWORD', 'DB_PASSWORD'],
  ['LICENSE_KEY', 'DIRECTUS_LICENSE_KEY'],
  ['EMAIL_FROM', 'EMAIL_FROM'],
  ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_HOST'],
  ['EMAIL_SMTP_PORT', 'EMAIL_SMTP_PORT'],
  ['EMAIL_SMTP_USER', 'EMAIL_SMTP_USER'],
  ['EMAIL_SMTP_PASSWORD', 'EMAIL_SMTP_PASSWORD'],
]);

const SECRET_DIRECTUS_KEYS = [
  'SECRET',
  'ADMIN_PASSWORD',
  'DB_PASSWORD',
  'LICENSE_KEY',
  'EMAIL_SMTP_PASSWORD',
];

const MESSAGES = {
  backend_not_internal: 'сеть базы данных должна иметь internal: true',
  directus_not_loopback: 'порт Directus должен публиковаться только на 127.0.0.1',
  environment_mapping_missing: 'отсутствует обязательное безопасное отображение переменной окружения',
  floating_image: 'образ не должен использовать latest или отсутствующий тег',
  healthcheck_missing: 'для службы требуется healthcheck',
  literal_secret: 'секрет должен поступать через подстановку окружения, а не храниться в Compose',
  media_policy_missing: 'не задано обязательное ограничение или хранилище медиа',
  no_new_privileges_missing: 'для службы требуется no-new-privileges:true',
  persistent_volume_missing: 'отсутствует обязательный постоянный именованный том',
  postgres_exposed: 'PostgreSQL нельзя публиковать на хосте',
  privileged_service: 'служба не должна запускаться в privileged-режиме или host network',
  restart_policy_missing: 'для службы требуется restart: unless-stopped',
  service_missing: 'отсутствует обязательная служба',
};

function serviceSection(source, serviceName) {
  const lines = source.split(/\r?\n/u);
  const serviceStart = lines.findIndex((line) => /^services:\s*$/u.test(line));
  if (serviceStart < 0) return '';

  const start = lines.findIndex((line, index) =>
    index > serviceStart && new RegExp(`^  ${serviceName}:\\s*$`, 'u').test(line));
  if (start < 0) return '';

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[^\s#][^:]*:\s*$/u.test(lines[index]) || /^  [a-zA-Z\d_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function topLevelSection(source, sectionName) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`^${sectionName}:\\s*$`, 'u').test(line));
  if (start < 0) return '';

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[^\s#][^:]*:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function addProblem(problems, code, subject, detail) {
  problems.push({ code, subject, detail, message: MESSAGES[code] });
}

function imageIsFloating(service) {
  const match = service.match(/^\s+image:\s*["']?([^\s"']+)/mu);
  if (!match) return true;
  const value = match[1];
  if (value.startsWith('${')) return false;
  return !value.includes(':') || /:latest$/iu.test(value);
}

function hasNoNewPrivileges(service) {
  return /no-new-privileges\s*:\s*["']?true/iu.test(service)
    || /no-new-privileges:true/iu.test(service);
}

function mappingPattern(targetKey, sourceKey) {
  return new RegExp(`^\\s+${targetKey}:\\s*["']?\\$\\{${sourceKey}(?::[^}]*)?\\}["']?\\s*$`, 'mu');
}

export function validateComposeText(source) {
  const problems = [];
  const postgres = serviceSection(source, 'postgres');
  const directus = serviceSection(source, 'directus');

  for (const [name, service] of [['postgres', postgres], ['directus', directus]]) {
    if (!service) {
      addProblem(problems, 'service_missing', name);
      continue;
    }
    if (imageIsFloating(service)) addProblem(problems, 'floating_image', name);
    if (!/^\s+healthcheck:/mu.test(service)) addProblem(problems, 'healthcheck_missing', name);
    if (!/^\s+restart:\s*unless-stopped\s*$/mu.test(service)) {
      addProblem(problems, 'restart_policy_missing', name);
    }
    if (!hasNoNewPrivileges(service)) addProblem(problems, 'no_new_privileges_missing', name);
    if (/^\s+privileged:\s*["']?true/mu.test(service) || /^\s+network_mode:\s*host/mu.test(service)) {
      addProblem(problems, 'privileged_service', name);
    }
  }

  if (postgres && /^\s+ports:/mu.test(postgres)) {
    addProblem(problems, 'postgres_exposed', 'postgres');
  }
  if (directus && !/127\.0\.0\.1:\d+:8055/u.test(directus)) {
    addProblem(problems, 'directus_not_loopback', 'directus');
  }

  const networks = topLevelSection(source, 'networks');
  if (!/^  cms-backend:\s*\r?\n(?: {4}.*\r?\n)* {4}internal:\s*true\s*$/mu.test(networks)) {
    addProblem(problems, 'backend_not_internal', 'cms-backend');
  }

  const volumes = topLevelSection(source, 'volumes');
  for (const volume of ['cms-postgres', 'cms-uploads']) {
    const declared = new RegExp(`^  ${volume}:`, 'mu').test(volumes);
    const mounted = new RegExp(`(?:^|\\s)${volume}:`, 'mu').test(source);
    if (!declared || !mounted) addProblem(problems, 'persistent_volume_missing', volume);
  }

  if (directus) {
    for (const [targetKey, sourceKey] of REQUIRED_DIRECTUS_MAPPINGS) {
      if (!mappingPattern(targetKey, sourceKey).test(directus)) {
        addProblem(problems, 'environment_mapping_missing', targetKey, sourceKey);
      }
    }

    for (const key of SECRET_DIRECTUS_KEYS) {
      const match = directus.match(new RegExp(`^\\s+${key}:\\s*["']?([^\\r\\n"']*)`, 'mu'));
      if (match && !match[1].trim().startsWith('${')) {
        addProblem(problems, 'literal_secret', key);
      }
    }

    for (const pattern of [
      /^\s+FILES_MAX_UPLOAD_SIZE:\s*20mb\s*$/mu,
      /^\s+FILES_MIME_TYPE_ALLOW_LIST:\s*image\/jpeg,image\/png,image\/webp,image\/gif,image\/svg\+xml,application\/pdf\s*$/mu,
      /^\s+STORAGE_LOCAL_ROOT:\s*\/directus\/uploads\s*$/mu,
    ]) {
      if (!pattern.test(directus)) addProblem(problems, 'media_policy_missing', pattern.source);
    }
  }

  return { problems };
}

export function formatComposeProblems(problems) {
  return problems.map(({ subject, message, detail }) =>
    `- ${subject}${detail ? ` (${detail})` : ''}: ${message}`).join('\n');
}

async function main() {
  const [composePath] = process.argv.slice(2);
  if (!composePath) throw new Error('Укажите путь к compose.yaml');

  const result = validateComposeText(await readFile(composePath, 'utf8'));
  if (result.problems.length > 0) {
    console.error('Compose CMS не прошёл контрактную проверку:');
    console.error(formatComposeProblems(result.problems));
    process.exitCode = 1;
    return;
  }
  console.log('Compose CMS прошёл статическую контрактную проверку.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
