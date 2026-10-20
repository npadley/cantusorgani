import { describe, expect, it } from 'vitest';
import { chantAnnouncement, chantCounts, chantNote, chantPartsPrinted, segmentKey } from './chantNotes';
import type { CanonicalPage, ChantRef, ExportPart, LayoutDiagnostic, ScanExportPart } from './types';

const ref = (id: number, incipit = `Chant ${id}`): ChantRef => ({ id, incipit, annotation: 'Intr.', mode: '1' });
const part = (id: string, chants: readonly ChantRef[]): ScanExportPart => ({
  id, kind: 'scan', label: id, heading: null, sourceSystemCount: 1, chants, sourceRevision: 's', stems: ['a'], customizableAvailable: false,
});
const THREE_OF_FOUR: ExportPart[] = [part('a:0', [ref(1)]), part('b:0', [ref(2)]), part('c:0', [ref(3)]), part('d:0', [])];
const unavailable = (partId: string): LayoutDiagnostic => ({
  code: 'CHANT_UNAVAILABLE', severity: 'info', partId, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail: '',
});

describe('chantAnnouncement', () => {
  it('names how many parts got chant and how many have none', () => {
    expect(chantAnnouncement('before', THREE_OF_FOUR)).toBe('Chant added before 3 parts. 1 part has no chant.');
  });
  it('is short when every part has chant, plural when several have none, and honest when none does', () => {
    expect(chantAnnouncement('before', [part('a:0', [ref(1)])])).toBe('Chant added before 1 part.');
    expect(chantAnnouncement('before', [part('a:0', [ref(1)]), part('b:0', []), part('c:0', [])])).toBe('Chant added before 1 part. 2 parts have no chant.');
    expect(chantAnnouncement('before', [part('a:0', [])])).toBe('No part in this PDF has a chant.');
    expect(chantAnnouncement('off', THREE_OF_FOUR)).toBe('Chant removed.');
  });
  it('counts a segment once, however many runs it splits into', () => {
    const runs = [part('seg:1:0', [ref(1)]), part('seg:1:1', []), part('other:0', [])];
    expect(chantCounts(runs)).toEqual({ withChant: 1, without: 1 });
    expect(segmentKey('seg:1:1')).toBe('seg:1');
  });
});

describe('chantNote', () => {
  it('says nothing when chant is off', () => {
    expect(chantNote(THREE_OF_FOUR[0]!, THREE_OF_FOUR, 'off', [])).toBeNull();
  });
  it('lists the chant of a part, says when there is none, and reports a chant that could not be drawn', () => {
    expect(chantNote(THREE_OF_FOUR[0]!, THREE_OF_FOUR, 'before', [])).toEqual({ text: 'With its chant', incipits: ['Chant 1'] });
    expect(chantNote(THREE_OF_FOUR[3]!, THREE_OF_FOUR, 'before', [])).toEqual({ text: 'No chant for this part.', incipits: [] });
    expect(chantNote(THREE_OF_FOUR[1]!, THREE_OF_FOUR, 'before', [unavailable('b:0')])?.text)
      .toBe('The chant could not be drawn; this part prints without it.');
  });
  it('shows nothing on the later runs of a segment', () => {
    const runs = [part('seg:1:0', [ref(1)]), part('seg:1:1', [])];
    expect(chantNote(runs[1]!, runs, 'before', [])).toBeNull();
  });
});

describe('chantPartsPrinted', () => {
  it('counts segments whose pages carry chant', () => {
    const page = (partId: string, n: number) => ({ partId, chant: Array.from({ length: n }) }) as unknown as CanonicalPage;
    expect(chantPartsPrinted([page('a:0', 2), page('a:0', 1), page('b:0', 0), page('c:0', 1)])).toBe(2);
    expect(chantPartsPrinted([])).toBe(0);
  });
});
