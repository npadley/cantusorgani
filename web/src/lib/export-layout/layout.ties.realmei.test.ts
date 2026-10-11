import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import { revealSplitSustainsAfter } from './meiDoc';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { SafeBoundary } from './types';

/**
 * A5e: ties on the real Kyrie IX conversion. The converter draws each tie as an explicit <tie> from the
 * first (visible) head of a note to the first head of the note it is tied to. Verovio must draw the arc
 * between exactly those two heads, never from a hidden split fragment, and unison heads of the chant and
 * the accompaniment must both be drawn.
 */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];
const HEAD_WIDTH = 226; // 0.01 mm units at unit 9
const X_SLACK = 150;
const Y_SLACK = 350;

interface Tie { readonly id: string; readonly start: string; readonly end: string }
const attr = (tag: string, name: string): string => new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag)?.[1] ?? '';
const meiTies = (xml: string): Tie[] =>
  [...xml.matchAll(/<tie\b[^>]*>/g)].map((m) => ({
    id: attr(m[0], 'xml:id'), start: attr(m[0], 'startid').slice(1), end: attr(m[0], 'endid').slice(1),
  }));
/** The `next` link of a note, whatever the attribute order. */
const nextOf = (xml: string, id: string): string | null => {
  const tag = [...xml.matchAll(/<note\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'xml:id') === id);
  return tag && attr(tag, 'next') ? attr(tag, 'next').slice(1) : null;
};

const S = 'http://www.w3.org/2000/svg';
const classes = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/);
function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

interface Point { readonly x: number; readonly y: number }
interface Drawn { readonly heads: Map<string, Point>; readonly ties: Map<string, { start: Point; end: Point }[]> }

/** Notehead positions by note id, and the first/last point of every drawn piece of every tie, in 0.01 mm. */
function measure(svg: string): Drawn {
  const root = new DOMParser({ onError: () => undefined }).parseFromString(svg, 'text/xml').documentElement!;
  const heads = new Map<string, Point>();
  const ties = new Map<string, { start: Point; end: Point }[]>();
  const walk = (el: Element, dx: number, dy: number): void => {
    const name = el.localName ?? el.nodeName;
    const cls = classes(el);
    if (name === 'g') {
      const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?/.exec(el.getAttribute('transform') ?? '');
      if (t) { dx += Number(t[1]); dy += Number(t[2] ?? 0); }
      const id = el.getAttribute('id');
      if (id && cls.includes('note') && !cls.includes('bounding-box')) {
        const use = el.getElementsByTagNameNS(S, 'use')[0];
        const m = use ? /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(use.getAttribute('transform') ?? '') : null;
        if (m) heads.set(id, { x: Number(m[1]) + dx, y: Number(m[2]) + dy });
      }
      if (cls.includes('tie') && !cls.includes('split-tie') && !cls.includes('bounding-box')) {
        const path = children(el).find((c) => (c.localName ?? c.nodeName) === 'path');
        const nums = (path?.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        if (nums.length >= 8) {
          const piece = { start: { x: nums[0]! + dx, y: nums[1]! + dy }, end: { x: nums[6]! + dx, y: nums[7]! + dy } };
          const key = id ?? ''; // the continuation piece after a system break carries no id
          ties.set(key, [...(ties.get(key) ?? []), piece]);
        }
      }
    }
    for (const c of children(el)) walk(c, dx, dy);
  };
  walk(root, 0, 0);
  return { heads, ties };
}

/** Problems for every expected tie: missing, or not starting/ending at the heads of its two notes. */
function tieProblems(pages: readonly string[], expected: readonly Tie[]): string[] {
  const drawn = pages.map(measure);
  const heads = new Map(drawn.flatMap((d) => [...d.heads]));
  const problems: string[] = [];
  const near = (p: Point, h: Point): boolean =>
    p.x >= h.x - X_SLACK && p.x <= h.x + HEAD_WIDTH + X_SLACK && Math.abs(p.y - h.y) <= Y_SLACK;
  for (const tie of expected) {
    const pieces = drawn.flatMap((d) => d.ties.get(tie.id) ?? []);
    const a = heads.get(tie.start);
    const b = heads.get(tie.end);
    if (pieces.length === 0) { problems.push(`${tie.id}: not drawn`); continue; }
    if (!a || !b) { problems.push(`${tie.id}: a head is not drawn`); continue; }
    // A tie across a system break is drawn as two pieces: one must start at the first head, one end at the last.
    if (!pieces.some((p) => near(p.start, a))) problems.push(`${tie.id}: no piece starts at its first head`);
    const everyPiece = drawn.flatMap((d) => [...d.ties.values()].flat());
    if (!everyPiece.some((p) => near(p.end, b))) problems.push(`${tie.id}: no piece ends at its last head`);
  }
  return problems;
}

describe('ties on the real Kyrie IX conversion (A5e)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const settings = (() => {
    const base = settingsOf({ page: 'ipad-13', orientation: 'portrait', staff: 'medium', linePolicy: 'original', maxSystems: null });
    return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
  })();
  const render = async (xml: string): Promise<string[]> => {
    const layout = await renderMei(partOf(xml, BOUNDARIES), settings, [], ctxOf(newToolkit()), rectsOf(settings));
    expect(errors(layout.diagnostics)).toEqual([]);
    return layout.pages.map((p) => p.svg);
  };

  it('has 68 explicit ties and no @tie attributes', () => {
    expect(meiTies(MEI)).toHaveLength(68);
    expect(MEI).not.toMatch(/<note\b[^>]*\stie="/);
  });

  it('draws every tie between the heads of its two notes (iPad 13-inch portrait)', async () => {
    expect(tieProblems(await render(MEI), meiTies(MEI))).toEqual([]);
  });

  it('flags a tie started from a hidden split fragment (mutation)', async () => {
    const ties = meiTies(MEI);
    // Old encoding: the outgoing tie started at the LAST fragment of a split sustain, not at the head.
    const chain = (id: string): string => {
      let cur = id;
      for (let next = nextOf(MEI, cur); next; next = nextOf(MEI, cur)) cur = next;
      return cur;
    };
    const victim = ties.find((t) => chain(t.start) !== t.start);
    expect(victim).toBeDefined();
    const mutated = MEI.replace(`startid="#${victim!.start}" xml:id="${victim!.id}"`, `startid="#${chain(victim!.start)}" xml:id="${victim!.id}"`);
    expect(mutated).not.toBe(MEI);
    const problems = tieProblems(await render(mutated), ties);
    expect(problems.some((p) => p.startsWith(`${victim!.id}:`))).toBe(true);
  });

  it('draws both the chant and the accompaniment head at each unison onset', async () => {
    // Chant quarter and accompaniment half on the same pitch and onset (found from the IR).
    const unisons: [string, string][] = [['ev0e0000', 'ev1e0000'], ['ev0e0019', 'ev1e0005'], ['ev0e0034', 'ev1e0011']];
    const heads = new Map((await render(MEI)).flatMap((svg) => [...measure(svg).heads]));
    for (const [chant, accompaniment] of unisons) {
      const a = heads.get(chant);
      const b = heads.get(accompaniment);
      expect(a, chant).toBeDefined();
      expect(b, accompaniment).toBeDefined();
      expect(Math.abs(a!.x - b!.x), `${chant}/${accompaniment} overlap`).toBeGreaterThanOrEqual(HEAD_WIDTH * 0.8);
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(30);
    }
  });
});

describe('revealing a split sustain moves its tie to the last revealed head', () => {
  it('retargets the tie start to the revealed continuation', () => {
    const tie = meiTies(MEI).find((t) => nextOf(MEI, t.start) !== null)!;
    const first = tie.start;
    const cont = nextOf(MEI, first)!;
    const measureOfFirst = [...MEI.matchAll(/<measure\b[^>]*?xml:id="([^"]+)"[\s\S]*?<\/measure>/g)]
      .find((mm) => mm[0].includes(`xml:id="${first}"`))![1]!;
    const out = revealSplitSustainsAfter(MEI, new Set([measureOfFirst]));
    const retargeted = meiTies(out).find((t) => t.id === tie.id)!;
    expect(retargeted.start).toBe(cont);
    expect(retargeted.end).toBe(tie.end);
    expect(out).toMatch(new RegExp(`<tie\\b[^>]*?endid="#${cont}"[^>]*?startid="#${first}"|<tie\\b[^>]*?startid="#${first}"[^>]*?endid="#${cont}"`)); // the split-tie head -> continuation
  });
});
