import { describe as group, expect, it } from "vitest";

import { describe, fileFor, isRedirect, linksIn, missingFrom, pathFor, reach } from "./reach";
import type { BuiltPage } from "./reach";

function page(path: string, ...links: string[]): BuiltPage {
  return { path, html: `<html><body>${links.map((l) => `<a class="x" href="${l}">x</a>`).join("")}</body></html>` };
}

group("paths", () => {
  it("should map dist files to the URLs they serve and back", () => {
    expect(pathFor("index.html")).toBe("/");
    expect(pathFor("piece/x/index.html")).toBe("/piece/x/");
    expect(pathFor("vendor/exsurge/exsurge.js")).toBe("/vendor/exsurge/exsurge.js");
    expect(fileFor("/piece/x/")).toBe("/piece/x/index.html");
  });

  it("should read internal links only, resolved, without hash or query", () => {
    const html = `<a href="/piece/a/#introit">1</a><a href='../b/?q=1'>2</a><a href="https://gregobase.selapa.net/x">3</a>
      <a href="#top">4</a><a href="mailto:x@y">5</a><a href="//cdn.example/x">6</a>`;
    expect(linksIn(html, "/piece/c/")).toEqual(["/piece/a/", "/piece/b/"]);
  });
});

group("reach", () => {
  it("should reach every linked page and report none orphaned", () => {
    const report = reach([page("/", "/a/"), page("/a/", "/b/", "/file.pdf"), page("/b/", "/")], new Set(["/file.pdf"]));
    expect(report.orphans).toEqual([]);
    expect(report.broken).toEqual([]);
    expect(report.reached).toBe(3);
  });

  it("should report a page no link leads to, like the Vespers pages once were", () => {
    const report = reach([page("/", "/vespers/"), page("/vespers/"), page("/vespers/2026-09-27/")], new Set());
    expect(report.orphans).toEqual(["/vespers/2026-09-27/"]);
    expect(describe(report, [])[0]).toMatch(/1 page\(s\) no link leads to/);
  });

  it("should report broken links, accept a link without its trailing slash, and skip redirects and 404", () => {
    const redirect: BuiltPage = { path: "/piece/old/", html: '<meta http-equiv="refresh" content="0;url=/kyriale/i/">' };
    const report = reach([page("/", "/a", "/gone/"), page("/a/"), redirect, page("/404/")], new Set());
    expect(report.broken).toEqual([["/", "/gone/"]]);
    expect(report.orphans).toEqual([]);
    expect(isRedirect(redirect.html)).toBe(true);
  });
});

group("missingFrom", () => {
  it("should list Vespers pages the index does not link", () => {
    const pages = [page("/vespers/", "/vespers/2026-09-27/"), page("/vespers/2026-09-27/"), page("/vespers/2026-10-04/i/")];
    const unlisted = missingFrom(pages[0], pages, /^\/vespers\/\d{4}-\d{2}-\d{2}\//);
    expect(unlisted).toEqual(["/vespers/2026-10-04/i/"]);
    expect(describe({ orphans: [], broken: [], reached: 1 }, unlisted).join("\n")).toContain("missing from /vespers/");
    expect(describe({ orphans: [], broken: [], reached: 1 }, [])).toEqual([]);
  });
});
