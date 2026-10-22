import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import Layout from './Layout.astro';

it.each([undefined, 'music', 'initium', 'chants'])('renders the skip link first with a unique target (%s)', async (skipTo) => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Layout, {
    props: { title: 'Skip link test', skipTo },
    request: new Request('https://cantusorgani.org/about/'),
    slots: { default: skipTo ? `<section id="${skipTo}">Music</section>` : '<h1>About</h1>' },
  });
  const target = skipTo ?? 'main-content';
  expect(html).toMatch(new RegExp(`<body[^>]*>\\s*<a[^>]*class="skip-link ui"[^>]*href="#${target}"[^>]*>${skipTo ? 'Skip to music' : 'Skip to main content'}</a>`));
  expect(html.match(new RegExp(`id="${target}"`, 'g'))).toHaveLength(1);
  expect(html).toMatch(/<main[^>]*id="main-content"[^>]*tabindex="-1"/);
});

it('only animates the skip link when motion is allowed', async () => {
  const css = await readFile(new URL('../styles/base.css', import.meta.url), 'utf8');
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion: no-preference\)\s*\{\s*\.skip-link\s*\{\s*transition: top 0\.15s;/);
});
