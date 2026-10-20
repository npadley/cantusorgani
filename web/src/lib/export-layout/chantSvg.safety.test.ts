import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSafeTransform, normalizeExsurgeSvg } from './chantSvg';

describe('isSafeTransform', () => {
  it.each(['translate(1,2)', 'scale(0.0625)', 'translate(0,23.5) scale(2)', ' scale( 1 , 2 ) ', 'translate(-3.5e1,0)'])('accepts %s', (v) => {
    expect(isSafeTransform(v)).toBe(true);
  });
  it.each(['', 'rotate(5)', 'translate(1,2,3)', 'scale(x)', 'translate(1,2', 'matrix(1,0,0,1,0,0)', 'scale(1) junk'])('rejects %j', (v) => {
    expect(isSafeTransform(v)).toBe(false);
  });
  it('finishes at once on pathological input (the old regex backtracked exponentially)', () => {
    const started = Date.now();
    for (const v of ['scale('.repeat(20000) + '-'.repeat(20000), 'scale(' + '-+'.repeat(40000) + ')scale(', 'translate(' + '1,'.repeat(50000)]) {
      expect(isSafeTransform(v)).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('normalizeExsurgeSvg root class', () => {
  it("drops Exsurge's root class so a page's own Exsurge stylesheet cannot restyle the export's lyrics", () => {
    const raw = (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', 'al-1-479.json'), 'utf8')) as { svg: string }).svg;
    expect(raw).toContain('class="Exsurge ChantScore"');
    const out = normalizeExsurgeSvg(raw);
    expect(/<svg\b[^>]*\bclass=/.test(out)).toBe(false);
    expect(out).not.toContain('Exsurge');
  });
});
