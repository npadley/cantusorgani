# Search and AI discovery

The production origin is `https://cantusorgani.org`, shared by Astro and
`web/src/lib/seo.ts`. Every HTML page has a canonical URL without query strings
or fragments, a description, and Open Graph / Twitter metadata. Public pages
also describe the website and page with JSON-LD. `social-card.png` is the default
sharing image, made from the site's typography and palette.

## Build and indexing policy

`pnpm build` runs `scripts/build-discovery.ts` after Astro. It scans rendered
HTML, checks the metadata, and writes `/sitemap.xml`. It excludes redirects,
admin/API pages, site search, the corrections form and the 404 page. The corrections log is
indexable. Both evergreen piece pages and dated Vespers have their own canonical
URLs; the dated order is not a duplicate of the book section. No Vespers routes
or generation-window behavior are changed here.

Sitemaps omit `lastmod` until meaningful page-change dates can be tracked
accurately; rebuilding alone is not a content change. Run `pnpm check:seo` to
regenerate and validate an existing `dist/` directory.

`robots.txt` allows public crawling, including AI discovery. It excludes the
API and Pagefind's internal files. Admin HTML uses `noindex, nofollow` and retains
its existing access controls; utility pages use `noindex, follow`. Do not disallow
these HTML pages in robots.txt: crawlers need to read their noindex metadata.
The `_headers` file also marks static admin, utility JSON and search resources
noindex. Function responses retain their own noindex headers.

Cloudflare Pages adds `X-Robots-Tag: noindex` to preview deployments. The
`_headers` rules also cover this project's pages.dev aliases. These rules do not
block the production custom domain. Custom preview domains need equivalent
indexing protection if introduced later.

Unknown URLs use the branded top-level `404.html`, which makes Cloudflare return
HTTP 404 instead of its home-page SPA fallback. The page offers search, calendar
and home links; it is noindex and absent from the sitemap.

## Public AI guide and citations

`/llms.txt` is a public navigation and citation guide, linked from the footer.
It explains the 1962 calendar, book sections versus dated orders, printed page
numbers, movement anchors, source licenses and proofreading status. It is not
a ranking guarantee or a special requirement for Google AI search. Expandable
Latin chant text is present in HTML without JavaScript and credits its source.

Crawler permission is not a license grant. This change does not configure a
separate AI-training opt-out policy or alter Cloudflare dashboard bot controls.
Check that intended search crawlers are not challenged by those controls.

## After merging and deploying

1. Fetch `/robots.txt`, `/sitemap.xml`, `/llms.txt` and a representative piece,
   Kyriale and dated Vespers page on the custom domain. Public pages should not
   carry a noindex response header.
2. Verify preview response headers still contain noindex.
3. Submit `https://cantusorgani.org/sitemap.xml` in Google Search Console.
4. Use URL Inspection for a piece and a dated Vespers page, then monitor the
   indexing and performance reports. Submission does not guarantee indexing.

References:
- [Google: build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Google: AI features](https://developers.google.com/search/docs/appearance/ai-features)
- [Cloudflare: preview indexing](https://developers.cloudflare.com/pages/configuration/preview-deployments/#preview-indexing-by-search-engines)
