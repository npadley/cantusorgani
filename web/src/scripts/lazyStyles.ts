// Load a stylesheet at run time, not with the page.
//
// A `import "x.css"` in a script that a page reaches only through a dynamic import() still gets its
// CSS linked into the page by the bundler, so the editor's styles would be fetched by every page with
// an export bar. Importing the file as a URL (`x.css?url`) emits it as an asset and links nothing; this
// adds the <link> when the editor is first used and resolves once it has loaded.

const loaded = new Map<string, Promise<void>>();

export function loadStylesheet(href: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  let p = loaded.get(href);
  if (p === undefined) {
    p = new Promise<void>((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      // A stylesheet that fails to load must not block the editor: it works, unstyled, and says so nowhere.
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.append(link);
    });
    loaded.set(href, p);
  }
  return p;
}
