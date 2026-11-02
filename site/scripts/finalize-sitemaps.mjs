import { copyFileSync } from 'node:fs';

// Yandex Webmaster already knows this legacy URL. Serve the same sitemap
// index with HTTP 200 so existing submissions continue to work.
copyFileSync(
  new URL('../dist/sitemap-index.xml', import.meta.url),
  new URL('../dist/sitemap_index.xml', import.meta.url),
);
