import type { APIRoute } from 'astro';
import { siteRoutes } from '../config/site';

export const prerender = true;

export const GET: APIRoute = () => {
  const release = {
    schemaVersion: 2,
    releaseId: import.meta.env.PUBLIC_RELEASE_ID || 'local-build',
    sourceCommit: import.meta.env.PUBLIC_SOURCE_COMMIT || 'working-tree',
    ...(import.meta.env.PUBLIC_SOURCE_SNAPSHOT_ID ? { sourceSnapshotId: import.meta.env.PUBLIC_SOURCE_SNAPSHOT_ID } : {}),
    ...(import.meta.env.PUBLIC_SOURCE_SNAPSHOT_SHA256 ? { sourceSnapshotSha256: import.meta.env.PUBLIC_SOURCE_SNAPSHOT_SHA256 } : {}),
    contentMode: import.meta.env.PUBLIC_CONTENT_MODE || 'repository',
    builtAt: import.meta.env.PUBLIC_BUILD_AT || new Date().toISOString(),
    routes: siteRoutes.map((route) => route.href),
  };

  return new Response(`${JSON.stringify(release, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
