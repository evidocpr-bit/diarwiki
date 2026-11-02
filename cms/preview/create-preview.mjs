import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generatePreviewContent } from '../../site/scripts/cms/generate-preview-content.mjs';
import { createPreviewAccessUrl, createPreviewGrant, PREVIEW_ID_PATTERN } from './preview-token.mjs';

function contained(root, target) {
  const relation = relative(resolve(root), resolve(target));
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
}

async function writeExclusive(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'wx');
  try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
}

async function filesRecursively(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  }
  await visit(root);
  return files;
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (chunk) => { output = `${output}${chunk}`.slice(-40_000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs ?? 180_000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else reject(new Error(`PREVIEW_BUILD_FAILED: ${code}\n${output}`));
    });
  });
}

async function defaultBuild(siteRoot) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return run(executable, ['exec', 'astro', 'build'], {
    cwd: siteRoot,
    env: {
      ...process.env,
      PUBLIC_SITE_INDEXABLE: 'false',
      PUBLIC_ANALYTICS_ENABLED: 'false',
      PUBLIC_PREVIEW_BUILD: 'true',
      PUBLIC_RELEASE_ID: 'preview',
    },
  });
}

async function verifyPreviewDist(dist, forbiddenValues = []) {
  const htmlFiles = (await filesRecursively(dist)).filter((path) => extname(path) === '.html');
  if (htmlFiles.length === 0) throw new Error('PREVIEW_HTML_MISSING');
  for (const path of htmlFiles) {
    const html = await readFile(path, 'utf8');
    if (!/<meta\b(?=[^>]*name=["']robots["'])(?=[^>]*content=["'][^"']*noindex)/iu.test(html)) {
      throw new Error(`PREVIEW_NOINDEX_MISSING: ${relative(dist, path)}`);
    }
    if (!/<meta\b(?=[^>]*name=["']referrer["'])(?=[^>]*content=["']no-referrer["'])/iu.test(html)) {
      throw new Error(`PREVIEW_REFERRER_POLICY_MISSING: ${relative(dist, path)}`);
    }
    if (/mc\.yandex\.|yastatic\.net|ym\(113733279/iu.test(html)) {
      throw new Error(`PREVIEW_ANALYTICS_FORBIDDEN: ${relative(dist, path)}`);
    }
    for (const value of forbiddenValues.filter(Boolean)) {
      if (html.includes(value)) throw new Error(`PREVIEW_SECRET_LEAK: ${relative(dist, path)}`);
    }
  }
  return { htmlFiles: htmlFiles.length };
}

async function hardenPreviewDist(dist) {
  const htmlFiles = (await filesRecursively(dist)).filter((path) => extname(path) === '.html');
  const robotsMeta = '<meta name="robots" content="noindex,nofollow">';
  const referrerMeta = '<meta name="referrer" content="no-referrer">';
  for (const path of htmlFiles) {
    let html = await readFile(path, 'utf8');
    const hasRobots = /<meta\b(?=[^>]*name=["']robots["'])(?=[^>]*content=["'][^"']*noindex)/iu.test(html);
    const hasReferrer = /<meta\b(?=[^>]*name=["']referrer["'])(?=[^>]*content=["']no-referrer["'])/iu.test(html);
    const additions = `${hasRobots ? '' : robotsMeta}${hasReferrer ? '' : referrerMeta}`;
    if (!additions) continue;
    html = /<head(?:\s[^>]*)?>/iu.test(html)
      ? html.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${additions}`)
      : `${additions}${html}`;
    await writeFile(path, html, 'utf8');
  }
}

async function copyPreviewMedia(input, workspaceRoot, siteRoot) {
  const extensionByMime = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'application/pdf': '.pdf',
  };
  for (const media of input.media_files ?? []) {
    if (!/^[a-f\d]{64}$/u.test(media.sha256 ?? '')) throw new Error('PREVIEW_MEDIA_HASH_INVALID');
    const source = resolve(workspaceRoot, media.source_path);
    if (!contained(workspaceRoot, source)) throw new Error('PREVIEW_MEDIA_PATH_ESCAPE');
    const bytes = await readFile(source);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== media.sha256) throw new Error('PREVIEW_MEDIA_HASH_MISMATCH');
    const extension = extensionByMime[media.mime_type] ?? extname(media.source_path).toLowerCase();
    const target = resolve(siteRoot, 'public', 'media', `${media.sha256}${extension}`);
    if (!contained(resolve(siteRoot, 'public'), target)) throw new Error('PREVIEW_MEDIA_TARGET_ESCAPE');
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { errorOnExist: true, force: false });
  }
}

export async function createPreview(input, options) {
  const previewId = input?.preview_id;
  if (!PREVIEW_ID_PATTERN.test(previewId ?? '')) throw new Error('PREVIEW_ID_INVALID');
  const previewRoot = resolve(options.previewRoot);
  const siteSource = resolve(options.siteRoot);
  const workspaceRoot = resolve(options.workspaceRoot ?? dirname(siteSource));
  await mkdir(join(previewRoot, 'p'), { recursive: true });
  await mkdir(join(previewRoot, '.meta'), { recursive: true });
  const target = resolve(previewRoot, 'p', previewId);
  if (!contained(resolve(previewRoot, 'p'), target)) throw new Error('PREVIEW_TARGET_ESCAPE');
  if (await lstat(target).catch(() => null)) throw new Error('PREVIEW_ALREADY_EXISTS');

  const grant = createPreviewGrant(options.secret, previewId, { ttlSeconds: options.ttlSeconds, now: options.now });
  const buildRoot = await mkdtemp(join(previewRoot, '.build-'));
  const tempSite = join(buildRoot, 'site');
  try {
    await cp(siteSource, tempSite, {
      recursive: true,
      filter(source) {
        const name = relative(siteSource, source).replaceAll('\\', '/');
        return !/^(?:node_modules|dist|\.astro)(?:\/|$)/u.test(name);
      },
    });
    const sourceNodeModules = join(siteSource, 'node_modules');
    if (!options.build && await lstat(sourceNodeModules).catch(() => null)) {
      await symlink(sourceNodeModules, join(tempSite, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    const sourceLibrary = join(workspaceRoot, 'library');
    if (await lstat(sourceLibrary).catch(() => null)) await cp(sourceLibrary, join(buildRoot, 'library'), { recursive: true });

    const generatedRoot = join(buildRoot, 'generated');
    await mkdir(generatedRoot, { recursive: true });
    await generatePreviewContent(input, generatedRoot);
    const docsTarget = join(tempSite, 'src', 'content', 'docs');
    const sourcesTarget = join(tempSite, 'src', 'content', 'sources');
    if (!contained(tempSite, docsTarget) || !contained(tempSite, sourcesTarget)) throw new Error('PREVIEW_CONTENT_TARGET_ESCAPE');
    await rm(docsTarget, { recursive: true, force: true });
    await rm(sourcesTarget, { recursive: true, force: true });
    await cp(join(generatedRoot, 'docs'), docsTarget, { recursive: true });
    await cp(join(generatedRoot, 'sources'), sourcesTarget, { recursive: true });
    await cp(join(generatedRoot, 'data'), join(tempSite, 'src', 'generated-cms-data'), { recursive: true });
    for (const page of input.content?.pages ?? []) {
      const astroPage = resolve(tempSite, 'src', 'pages', `${page.slug}.astro`);
      if (!contained(resolve(tempSite, 'src', 'pages'), astroPage)) throw new Error('PREVIEW_PAGE_PATH_ESCAPE');
      await rm(astroPage, { force: true });
    }
    await copyPreviewMedia(input, workspaceRoot, tempSite);

    await (options.build ?? defaultBuild)(tempSite);
    const dist = join(tempSite, 'dist');
    await hardenPreviewDist(dist);
    const verification = await verifyPreviewDist(dist, [options.secret, grant.token, grant.signature]);
    await (options.publish ?? rename)(dist, target);
    const metadata = {
      schema_version: 1, preview_id: previewId,
      created_at: new Date((options.now ?? Date.now())).toISOString(),
      expires_at: new Date(grant.expires * 1000).toISOString(),
      snapshot_sha256: input.snapshot_sha256 ?? null,
      html_files: verification.htmlFiles,
    };
    try {
      await writeExclusive(join(previewRoot, '.meta', `${previewId}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
    return { previewId, expiresAt: metadata.expires_at, accessUrl: createPreviewAccessUrl(options.origin, grant) };
  } finally {
    if (contained(previewRoot, buildRoot)) await rm(buildRoot, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const options = { workspaceRoot: process.cwd(), ttlSeconds: 60 * 60 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = resolve(argv[++index]);
    else if (argv[index] === '--site') options.siteRoot = resolve(argv[++index]);
    else if (argv[index] === '--root') options.previewRoot = resolve(argv[++index]);
    else if (argv[index] === '--workspace') options.workspaceRoot = resolve(argv[++index]);
    else if (argv[index] === '--ttl-seconds') options.ttlSeconds = Number(argv[++index]);
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const secret = process.env.DIARWIKI_PREVIEW_SECRET;
  const origin = process.env.DIARWIKI_PREVIEW_ORIGIN ?? 'https://preview.diarwiki.ru';
  if (!options.input || !options.siteRoot || !options.previewRoot || !secret) {
    throw new Error('Требуются --input, --site, --root и DIARWIKI_PREVIEW_SECRET.');
  }
  const input = JSON.parse(await readFile(options.input, 'utf8'));
  const result = await createPreview(input, { ...options, secret, origin });
  console.log(`Предпросмотр готов до ${result.expiresAt}: ${result.accessUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
