import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const output = fileURLToPath(new URL('../dist/', import.meta.url));
const search = join(output, 'pagefind');

function validate() {
  const metadata = JSON.parse(readFileSync(join(search, 'pagefind-entry.json'), 'utf8'));
  const language = metadata.languages?.ru;
  if (!language?.hash || !language.wasm || language.page_count < 8) throw new Error('Russian search index is incomplete.');
  for (const file of ['pagefind.js', 'pagefind-worker.js', `pagefind.${language.hash}.pf_meta`, `wasm.${language.wasm}.pagefind`]) {
    if (statSync(join(search, file)).size === 0) throw new Error(`Empty search asset: ${file}`);
  }
  return language.page_count;
}

try {
  console.log(`Checked search index: ${validate()} pages.`);
} catch (error) {
  // The native API can return before its entry file has been fully written on
  // Windows. A standalone CLI process must finish before its output is used.
  console.warn(`Search index validation failed (${error.message}); rebuilding with Pagefind CLI.`);
  const starlightRequire = createRequire(import.meta.resolve('@astrojs/starlight'));
  const packageFile = starlightRequire.resolve.paths('pagefind')
    .map((path) => join(path, 'pagefind/package.json')).find(existsSync);
  if (!packageFile) throw new Error('The installed Starlight Pagefind dependency was not found.');
  const cli = join(dirname(packageFile), JSON.parse(readFileSync(packageFile, 'utf8')).bin);
  const result = spawnSync(process.execPath, [cli, '--site', output], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pagefind CLI failed: ${result.status}`);
  console.log(`Checked rebuilt search index: ${validate()} pages.`);
}
