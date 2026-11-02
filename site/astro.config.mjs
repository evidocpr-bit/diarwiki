import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidebarNavigation, siteIdentity } from './src/config/site.ts';

const docsRoot = fileURLToPath(new URL('./src/content/docs/', import.meta.url));
const contentLastmod = new Map();

function collectContentLastmod(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectContentLastmod(file);
      continue;
    }
    if (!['.md', '.mdx'].includes(extname(entry.name))) continue;

    const source = readFileSync(file, 'utf8');
    const updatedAt = source.match(/^updatedAt:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m)?.[1];
    if (!updatedAt) continue;

    const slug = relative(docsRoot, file).replaceAll('\\', '/').replace(/\.mdx?$/i, '');
    let pathname = `/${slug}/`.replace(/\/index\/$/i, '/').replace(/^\/index\/$/i, '/');
    contentLastmod.set(new URL(pathname, siteIdentity.origin).href, new Date(`${updatedAt}T00:00:00.000Z`));
  }
}

collectContentLastmod(docsRoot);

export default defineConfig({
  site: siteIdentity.origin,
  output: 'static',
  integrations: [
    starlight({
      title: siteIdentity.name,
      description: siteIdentity.description,
      favicon: '/favicon.svg',
      defaultLocale: 'ru',
      locales: {
        root: { label: 'Русский', lang: 'ru' },
      },
      customCss: ['./src/styles/starlight.css'],
      components: {
        Head: './src/components/starlight/CustomHead.astro',
        Header: './src/components/starlight/Header.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
        MarkdownContent: './src/components/starlight/MarkdownContent.astro',
        Footer: './src/components/starlight/CustomFooter.astro',
        ThemeSelect: './src/components/starlight/Empty.astro',
      },
      sidebar: sidebarNavigation,
      lastUpdated: true,
      credits: false,
      social: [],
      disable404Route: true,
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#f4f3ee' } },
        { tag: 'meta', attrs: { name: 'color-scheme', content: 'light' } },
      ],
    }),
    mdx(),
    sitemap({
      // /tools/ is a redirect to the calculator, not an indexable page.
      filter: (page) => !['/404.html', '/search/', '/tools/'].includes(new URL(page).pathname),
      serialize(item) {
        const lastmod = contentLastmod.get(item.url);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
  markdown: {
    shikiConfig: { theme: 'github-light' },
  },
});
