import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DirectusApi } from '../bootstrap/directus-api.mjs';
import { createSnapshot, writeSnapshotExclusive } from './create-snapshot.mjs';
import { downloadReleaseMedia, fetchReleaseInput } from './fetch-release-input.mjs';
import { acquireReleaseLock } from './release-lock.mjs';
import { reportReleaseFailure, reportReleaseSuccess } from './report-result.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ReleasePipelineError extends Error {
  constructor(code, message = code, cause) { super(message, { cause }); this.name = 'ReleasePipelineError'; this.code = code; }
}

export function createReleaseId(date, sourceCommit) {
  const stamp = date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
  const suffix = String(sourceCommit).toLowerCase().match(/[a-f\d]{7,40}/u)?.[0]?.slice(0, 12);
  if (!suffix) throw new ReleasePipelineError('SOURCE_COMMIT_INVALID');
  return `${stamp}-${suffix}`;
}

export async function withTimeout(label, milliseconds, operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new ReleasePipelineError('RELEASE_STAGE_TIMEOUT', `${label} timed out`)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function claimReleaseRequest(api, maxAttempts = 3) {
  const requests = await api.get('/items/release_requests?filter[status][_eq]=queued&sort=requested_at&limit=1');
  const request = requests?.[0];
  if (!request) return null;
  if (Number(request.attempt_count ?? 0) >= maxAttempts) {
    await api.patch(`/items/release_requests/${encodeURIComponent(request.id)}`, {
      status: 'failed', last_error_code: 'RETRY_LIMIT_REACHED',
      last_error_summary: 'Превышено максимальное число попыток выпуска.',
    });
    return null;
  }
  const claimed = await api.patch(`/items/release_requests/${encodeURIComponent(request.id)}`, {
    status: 'building', attempt_count: Number(request.attempt_count ?? 0) + 1,
    last_error_code: null, last_error_summary: null,
  });
  if (claimed?.status && claimed.status !== 'building') throw new ReleasePipelineError('RELEASE_CLAIM_LOST');
  return { ...request, ...claimed, status: 'building', attempt_count: Number(request.attempt_count ?? 0) + 1 };
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'pipe', windowsHide: true, ...options });
    let output = '';
    const append = (chunk) => { output = `${output}${chunk}`.slice(-20_000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0
      ? resolvePromise(output)
      : reject(new ReleasePipelineError('RELEASE_COMMAND_FAILED', `${command} exited ${code ?? signal}: ${output}`)));
  });
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function copySite(source, destination) {
  await cp(source, destination, {
    recursive: true,
    filter: (path) => !['node_modules', 'dist', '.astro', 'playwright-report', 'test-results']
      .includes(basename(path)),
  });
  const modules = join(source, 'node_modules');
  if ((await lstat(modules).catch(() => null))?.isDirectory()) await symlink(modules, join(destination, 'node_modules'), 'junction');
}

export async function buildReleaseArtifact(context, options = {}) {
  const sourceSite = options.siteRoot ?? join(projectRoot, 'site');
  const workRoot = await mkdtemp(join(options.workRoot ?? tmpdir(), 'diarwiki-release-'));
  const siteRoot = join(workRoot, 'site');
  const generatedRoot = join(workRoot, 'generated');
  const snapshotPath = join(workRoot, `${context.snapshot.snapshot_id}.json`);
  const archivePath = join(options.archiveRoot ?? tmpdir(), `diarwiki-${context.releaseId}.tar.gz`);
  const manifestPath = join(options.archiveRoot ?? tmpdir(), `diarwiki-${context.releaseId}.manifest.json`);
  const { generateContent } = await import('../../site/scripts/cms/generate-content.mjs');

  await copySite(sourceSite, siteRoot);
  if (await lstat(archivePath).catch(() => null)) throw new ReleasePipelineError('RELEASE_ARTIFACT_ALREADY_EXISTS');
  if (await lstat(manifestPath).catch(() => null)) throw new ReleasePipelineError('RELEASE_ARTIFACT_ALREADY_EXISTS');
  await mkdir(generatedRoot, { recursive: true });
  await writeSnapshotExclusive(snapshotPath, context.snapshot);
  await generateContent(context.snapshot, generatedRoot);
  await rm(join(siteRoot, 'src', 'content', 'docs'), { recursive: true, force: true });
  await rm(join(siteRoot, 'src', 'data', 'sources'), { recursive: true, force: true });
  await rm(join(siteRoot, 'review-records'), { recursive: true, force: true });
  await cp(join(generatedRoot, 'docs'), join(siteRoot, 'src', 'content', 'docs'), { recursive: true });
  await cp(join(generatedRoot, 'sources'), join(siteRoot, 'src', 'data', 'sources'), { recursive: true });
  await cp(join(generatedRoot, 'data'), join(siteRoot, 'src', 'generated-cms-data'), { recursive: true });
  await cp(join(generatedRoot, 'review-records'), join(siteRoot, 'review-records'), { recursive: true });
  await downloadReleaseMedia(context.api, context.mediaFiles, join(siteRoot, 'public', 'media'));
  const environment = {
    ...process.env,
    PUBLIC_SITE_INDEXABLE: 'true', PUBLIC_ANALYTICS_ENABLED: 'true', PUBLIC_PREVIEW_BUILD: 'false',
    PUBLIC_CONTENT_MODE: 'cms-snapshot', PUBLIC_RELEASE_ID: context.releaseId,
    PUBLIC_SOURCE_COMMIT: context.sourceCommit,
    PUBLIC_SOURCE_SNAPSHOT_ID: context.snapshot.snapshot_id,
    PUBLIC_SOURCE_SNAPSHOT_SHA256: context.snapshot.snapshot_sha256,
    PUBLIC_BUILD_AT: context.builtAt,
  };
  await run('pnpm', ['test', '--', '--reporter=dot'], { cwd: siteRoot, env: environment });
  await run('pnpm', ['run', 'build'], { cwd: siteRoot, env: environment });
  const releaseJson = JSON.parse(await readFile(join(siteRoot, 'dist', 'release.json'), 'utf8'));
  if (releaseJson.releaseId !== context.releaseId || releaseJson.sourceSnapshotSha256 !== context.snapshot.snapshot_sha256) {
    throw new ReleasePipelineError('RELEASE_METADATA_MISMATCH');
  }
  await run('tar', ['-czf', archivePath, '-C', join(siteRoot, 'dist'), '.']);
  const archiveSha256 = await sha256File(archivePath);
  const manifest = {
    schema_version: 1, release_id: context.releaseId, source_commit: context.sourceCommit,
    snapshot_id: context.snapshot.snapshot_id, snapshot_sha256: context.snapshot.snapshot_sha256,
    archive_sha256: archiveSha256, built_at: context.builtAt, routes: context.snapshot.manifest.routes,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o440 });
  return { archivePath, archiveSha256, manifestPath, workRoot, releaseJson };
}

export async function currentRelease(siteRoot = '/srv/diarwiki') {
  const link = await readlink(join(siteRoot, 'current')).catch(() => null);
  return link ? basename(link) : null;
}

function defaults(environment = process.env) {
  const api = new DirectusApi(environment.DIRECTUS_URL ?? 'http://invalid.local', environment.RELEASE_SERVICE_TOKEN ?? 'missing');
  const deployRoot = environment.RELEASE_DEPLOY_ROOT ?? join(projectRoot, 'site', 'deploy');
  return {
    api,
    lock: () => acquireReleaseLock(environment.RELEASE_LOCK_FILE ?? join(tmpdir(), 'diarwiki-release.lock')),
    claim: () => claimReleaseRequest(api, Number(environment.RELEASE_MAX_ATTEMPTS ?? 3)),
    sourceCommit: async () => (await run('git', ['-c', `safe.directory=${projectRoot}`, 'rev-parse', 'HEAD'], { cwd: projectRoot })).trim(),
    fetchInput: (request, sourceCommit) => fetchReleaseInput(api, request, { sourceCommit }),
    snapshot: createSnapshot,
    build: (context) => buildReleaseArtifact(context, { siteRoot: environment.RELEASE_SITE_SOURCE, workRoot: environment.RELEASE_WORK_ROOT }),
    current: () => currentRelease(environment.RELEASE_SITE_ROOT),
    activate: (context) => run(environment.RELEASE_ACTIVATE_COMMAND ?? join(deployRoot, 'activate-release.sh'), [context.releaseId, context.artifact.archivePath, context.artifact.archiveSha256, context.artifact.manifestPath]),
    verify: (context) => run(environment.RELEASE_VERIFY_COMMAND ?? join(deployRoot, 'verify-release.sh'), [context.releaseId, context.snapshot.snapshot_sha256]),
    rollback: (releaseId) => run(environment.RELEASE_ROLLBACK_COMMAND ?? join(deployRoot, 'rollback-release.sh'), [releaseId]),
    reportSuccess: (request, release, reportOptions) => reportReleaseSuccess(api, request, release, reportOptions),
    reportFailure: (request, error) => reportReleaseFailure(api, request, error, { incrementAttempt: false }),
    cleanup: (artifact) => artifact?.workRoot ? rm(artifact.workRoot, { recursive: true, force: true }) : undefined,
  };
}

export async function runReleaseJob(options = {}, injected = {}) {
  const dependencies = { ...defaults(options.environment), ...injected };
  const timeoutMs = options.stageTimeoutMs ?? 15 * 60 * 1000;
  const lock = await dependencies.lock();
  let request; let artifact; let previousRelease; let activationAttempted = false;
  try {
    request = await withTimeout('claim', timeoutMs, dependencies.claim);
    if (!request) return { status: 'idle' };
    const sourceCommit = await withTimeout('source-commit', timeoutMs, dependencies.sourceCommit);
    const releaseId = createReleaseId(options.now ?? new Date(), sourceCommit);
    const input = await withTimeout('fetch-input', timeoutMs, () => dependencies.fetchInput(request, sourceCommit));
    const snapshot = dependencies.snapshot(input.snapshotInput);
    previousRelease = await dependencies.current();
    const builtAt = (options.now ?? new Date()).toISOString();
    const context = { api: dependencies.api, request, releaseId, sourceCommit, snapshot, mediaFiles: input.mediaFiles, builtAt };
    artifact = await withTimeout('build', timeoutMs, () => dependencies.build(context));
    activationAttempted = true;
    await withTimeout('activate', timeoutMs, () => dependencies.activate({ ...context, artifact }));
    const verificationOutput = await withTimeout('verify', timeoutMs, () => dependencies.verify({ ...context, artifact }));
    const activatedAt = new Date().toISOString();
    const release = {
      id: randomUUID(), release_id: releaseId, request: request.id, status: 'published', source_commit: sourceCommit,
      snapshot_id: snapshot.snapshot_id, snapshot_sha256: snapshot.snapshot_sha256,
      archive_sha256: artifact.archiveSha256, previous_release_id: previousRelease,
      routes: snapshot.manifest.routes,
      material_versions: snapshot.content.materials.map((item) => ({ content_id: item.content_id, review_fingerprint: item.review_fingerprint })),
      built_at: builtAt, activated_at: activatedAt,
      verification_result: { passed: true, checked_at: activatedAt, output: String(verificationOutput ?? '').slice(-4000) },
    };
    await withTimeout('report-success', timeoutMs, () => dependencies.reportSuccess(request, release, {
      materials: input.snapshotInput.materials.filter(({ workflow_status }) => workflow_status === 'ready_to_publish'),
      pages: input.snapshotInput.pages.filter(({ workflow_status }) => workflow_status === 'ready_to_publish'),
    }));
    return { status: 'published', release };
  } catch (error) {
    let finalError = error;
    if (activationAttempted) {
      if (!previousRelease) finalError = new ReleasePipelineError('ROLLBACK_TARGET_MISSING', 'Activation failed without a previous release', error);
      else {
        try { await withTimeout('rollback', timeoutMs, () => dependencies.rollback(previousRelease)); }
        catch (rollbackError) { finalError = new ReleasePipelineError('ROLLBACK_FAILED', `Rollback failed after: ${error.message}`, rollbackError); }
      }
    }
    if (request) await dependencies.reportFailure(request, finalError).catch(() => {});
    throw finalError;
  } finally {
    await dependencies.cleanup(artifact).catch(() => {});
    await lock.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runReleaseJob();
  console.log(result.status === 'idle' ? 'Нет запросов выпуска.' : `Выпуск ${result.release.release_id} опубликован.`);
}
