import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { revealSplitSustainsAfter } from './meiDoc';

const MEI = readFileSync(join(__dirname, '__fixtures__', 'al-dominus-exsultet.mei'), 'utf8');
const tags = (xml: string, pred: (t: string) => boolean): string[] => [...xml.matchAll(/<note\b[^>]*>/g)].map((m) => m[0]).filter(pred);
const isContinuation = (t: string): boolean => t.includes('type="split-continuation"');

describe('dotted split continuations (A8)', () => {
  it('are encoded fully hidden, and a break unhides them but not hidden voice-line continuations', () => {
    const dotted = tags(MEI, (t) => isContinuation(t) && t.includes('dots=') && !/stem\.visible="false"[^>]*xml:id="ev3/.test(t));
    expect(dotted.length).toBeGreaterThan(0);
    expect(dotted.every((t) => t.includes('visible="false"') && t.includes('head.visible="false"'))).toBe(true);

    const allMeasures = new Set([...MEI.matchAll(/<measure\b[^>]*?xml:id="([^"]+)"/g)].map((m) => m[1]!));
    const revealed = revealSplitSustainsAfter(MEI, allMeasures);
    const stillHidden = tags(revealed, (t) => isContinuation(t) && / visible="false"/.test(t));
    // What stays hidden after every break is exactly a continuation of an originally hidden (voice-line) note.
    const hiddenFirst = new Set(tags(MEI, (t) => !isContinuation(t) && / visible="false"/.test(t))
      .map((t) => /xml:id="([^"]+)"/.exec(t)![1]!));
    for (const t of stillHidden) expect(hiddenFirst.has(/prev="#([^"c]*)/.exec(t)?.[1] ?? '')).toBe(true);
    const unhidden = tags(revealed, (t) => isContinuation(t) && t.includes('dots=') && !/ visible="false"/.test(t));
    expect(unhidden.length).toBeGreaterThan(0);
  });
});
