import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const src = fileURLToPath(new URL('../../', import.meta.url));
function violations(file: string, source: string): string[] {
  if (file === 'lib/export-layout/selection.ts') return [];
  return source.split('\n').flatMap((line, i) =>
    line.includes('@2x.png') ? [`${file}:${i + 1}: ${line.trim()}`] : []);
}
it('builds scan PNG URLs only in selection.ts', () => {
  const hits: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|astro)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        hits.push(...violations(relative(src, file), readFileSync(file, 'utf8')));
      }
    }
  }
  walk(src);
  expect(hits, hits.join('\n')).toEqual([]);
});
it.each(['lib/export-layout/compose.ts', 'lib/export-layout/exportPdf.ts', 'scripts/exportPagePreview.ts', 'lib/pdf.ts'])(
  'rejects the former bare URL pattern in %s with its line number', (file) => {
    const line = 'const url = `${stem}@2x.png`;';
    expect(violations(file, '\n' + line)).toEqual([`${file}:2: ${line}`]);
  },
);
