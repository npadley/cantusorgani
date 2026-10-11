import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { EXPORT_CEILING } from '../config';
import { parseResourceProfile, checkLayoutBudget, admitThenLoad } from './limits';
import { PROVISIONAL_LIMITS } from './types';
import type { BudgetDecision, BudgetInput, ResourceProfile } from './types';

const profileFile = new URL('../../../../data/typeset/mei/resource-profile.json', import.meta.url);

function makeProfile(overrides: Partial<ResourceProfile> = {}): ResourceProfile {
  return {
    version: 1,
    provisional: true,
    limits: PROVISIONAL_LIMITS,
    maxAggregateEvents: 60000,
    measuredOn: [],
    rendererDigest: '',
    fontDigest: '',
    ...overrides,
  };
}

function makeInput(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return { meiBytes: [1_000_000], eventCounts: [10_000], sourceSystems: 100, predictedPages: 50, ...overrides };
}

function expectRejected(decision: BudgetDecision): { code: string; limit: string } {
  if (decision.eligible) throw new Error('expected rejection');
  return { code: decision.code, limit: decision.limit };
}

const profile = makeProfile();

describe('parseResourceProfile', () => {
  it('should accept a valid profile unchanged', () => {
    expect(parseResourceProfile(makeProfile())).toEqual(makeProfile());
  });

  it('should parse the checked-in resource-profile.json', () => {
    const parsed = parseResourceProfile(JSON.parse(readFileSync(profileFile, 'utf8')));
    expect(parsed.provisional).toBe(true);
    expect(parsed.limits).toEqual(PROVISIONAL_LIMITS);
    expect(parsed.maxAggregateEvents).toBe(60000);
  });

  it.each(['version', 'provisional', 'limits', 'maxAggregateEvents', 'measuredOn', 'rendererDigest', 'fontDigest'])(
    'should throw INVALID_PROFILE when %s is missing',
    (field) => {
      const raw: Record<string, unknown> = { ...makeProfile() };
      delete raw[field];
      expect(() => parseResourceProfile(raw)).toThrow('INVALID_PROFILE');
    },
  );

  it.each([0, -1, NaN, Infinity, '8388608'])('should throw INVALID_PROFILE for maxMeiBytes %s', (value) => {
    expect(() => parseResourceProfile(makeProfile({ limits: { ...PROVISIONAL_LIMITS, maxMeiBytes: value as number } }))).toThrow(
      'INVALID_PROFILE',
    );
  });

  it.each([0, -5, NaN, Infinity])('should throw INVALID_PROFILE for maxEvents, maxPages and jobTimeoutMs %s', (value) => {
    expect(() => parseResourceProfile(makeProfile({ limits: { ...PROVISIONAL_LIMITS, maxEvents: value } }))).toThrow('INVALID_PROFILE');
    expect(() => parseResourceProfile(makeProfile({ limits: { ...PROVISIONAL_LIMITS, maxPages: value } }))).toThrow('INVALID_PROFILE');
    expect(() => parseResourceProfile(makeProfile({ limits: { ...PROVISIONAL_LIMITS, jobTimeoutMs: value } }))).toThrow('INVALID_PROFILE');
  });

  it.each([0, -1, NaN])('should throw INVALID_PROFILE for maxAggregateEvents %s', (value) => {
    expect(() => parseResourceProfile(makeProfile({ maxAggregateEvents: value }))).toThrow('INVALID_PROFILE');
  });

  it('should throw INVALID_PROFILE for a string profile', () => {
    expect(() => parseResourceProfile('not a profile')).toThrow('INVALID_PROFILE');
  });

  it('should throw INVALID_PROFILE for a malformed measurement entry', () => {
    expect(() => parseResourceProfile(makeProfile({ measuredOn: [{ device: 'iPad' }] as unknown as ResourceProfile['measuredOn'] }))).toThrow(
      'INVALID_PROFILE',
    );
  });
});

describe('checkLayoutBudget', () => {
  it('should return eligible for a comfortable budget', () => {
    expect(checkLayoutBudget(makeInput(), profile)).toEqual({ eligible: true });
  });

  it('should accept exactly 300 source systems and reject 301 with SOURCE_CEILING', () => {
    expect(checkLayoutBudget(makeInput({ sourceSystems: EXPORT_CEILING }), profile)).toEqual({ eligible: true });
    expect(expectRejected(checkLayoutBudget(makeInput({ sourceSystems: EXPORT_CEILING + 1 }), profile))).toEqual({
      code: 'SOURCE_CEILING',
      limit: '300 source systems',
    });
  });

  it('should accept meiBytes at the limit and reject one byte above', () => {
    expect(checkLayoutBudget(makeInput({ meiBytes: [PROVISIONAL_LIMITS.maxMeiBytes] }), profile)).toEqual({ eligible: true });
    const rejected = expectRejected(checkLayoutBudget(makeInput({ meiBytes: [PROVISIONAL_LIMITS.maxMeiBytes + 1] }), profile));
    expect(rejected.code).toBe('BUDGET_EXCEEDED');
    expect(rejected.limit).toBe('8 MiB per part');
  });

  it('should reject when any single part exceeds meiBytes', () => {
    const input = makeInput({ meiBytes: [4_000_000, PROVISIONAL_LIMITS.maxMeiBytes + 1] });
    expect(expectRejected(checkLayoutBudget(input, profile)).code).toBe('BUDGET_EXCEEDED');
  });

  it('should accept eventCounts at the limit and reject one above', () => {
    expect(checkLayoutBudget(makeInput({ eventCounts: [PROVISIONAL_LIMITS.maxEvents] }), profile)).toEqual({ eligible: true });
    const rejected = expectRejected(checkLayoutBudget(makeInput({ eventCounts: [PROVISIONAL_LIMITS.maxEvents + 1] }), profile));
    expect(rejected).toEqual({ code: 'BUDGET_EXCEEDED', limit: '20000 events per part' });
  });

  it('should accept an aggregate at maxAggregateEvents and reject one above', () => {
    // Each part stays under maxEvents so only the aggregate can fail.
    expect(checkLayoutBudget(makeInput({ eventCounts: [19000, 19000, 19000, 3000] }), profile)).toEqual({ eligible: true });
    const rejected = expectRejected(checkLayoutBudget(makeInput({ eventCounts: [19000, 19000, 19000, 3001] }), profile));
    expect(rejected).toEqual({ code: 'BUDGET_EXCEEDED', limit: '60000 events per selection' });
  });

  it('should accept predictedPages at the limit and reject one above', () => {
    expect(checkLayoutBudget(makeInput({ predictedPages: PROVISIONAL_LIMITS.maxPages }), profile)).toEqual({ eligible: true });
    const rejected = expectRejected(checkLayoutBudget(makeInput({ predictedPages: PROVISIONAL_LIMITS.maxPages + 1 }), profile));
    expect(rejected).toEqual({ code: 'BUDGET_EXCEEDED', limit: '100 pages per selection' });
  });

  it('should be eligible for an empty selection', () => {
    expect(checkLayoutBudget(makeInput({ meiBytes: [], eventCounts: [], sourceSystems: 0, predictedPages: 0 }), profile)).toEqual({
      eligible: true,
    });
  });

  it('should report SOURCE_CEILING before every budget limit when all fail', () => {
    const input = makeInput({
      sourceSystems: 301,
      meiBytes: [PROVISIONAL_LIMITS.maxMeiBytes + 1],
      eventCounts: [PROVISIONAL_LIMITS.maxEvents + 1],
      predictedPages: PROVISIONAL_LIMITS.maxPages + 1,
    });
    expect(expectRejected(checkLayoutBudget(input, profile)).code).toBe('SOURCE_CEILING');
  });

  it('should report meiBytes before eventCounts, aggregate and pages', () => {
    const input = makeInput({
      meiBytes: [PROVISIONAL_LIMITS.maxMeiBytes + 1],
      eventCounts: [PROVISIONAL_LIMITS.maxEvents + 1],
      predictedPages: PROVISIONAL_LIMITS.maxPages + 1,
    });
    expect(expectRejected(checkLayoutBudget(input, profile)).limit).toBe('8 MiB per part');
  });

  it('should report per-part events before the aggregate', () => {
    const input = makeInput({ eventCounts: [PROVISIONAL_LIMITS.maxEvents + 1, 50_000] });
    expect(expectRejected(checkLayoutBudget(input, profile)).limit).toBe('20000 events per part');
  });

  it('should report the aggregate before predictedPages', () => {
    const input = makeInput({ eventCounts: [20000, 20000, 20000, 1], predictedPages: PROVISIONAL_LIMITS.maxPages + 1 });
    expect(expectRejected(checkLayoutBudget(input, profile)).limit).toBe('60000 events per selection');
  });
});

describe('admitThenLoad', () => {
  it('should not call loadRenderer when the budget is rejected', async () => {
    const loadRenderer = vi.fn(async () => 'renderer');
    const result = await admitThenLoad(makeInput({ sourceSystems: 301 }), profile, loadRenderer);
    expect(result).toEqual({ eligible: false, code: 'SOURCE_CEILING', limit: '300 source systems' });
    expect(loadRenderer).not.toHaveBeenCalled();
  });

  it('should call loadRenderer exactly once and return its value when eligible', async () => {
    const loadRenderer = vi.fn(async () => 'renderer');
    const result = await admitThenLoad(makeInput(), profile, loadRenderer);
    expect(result).toEqual({ eligible: true, renderer: 'renderer' });
    expect(loadRenderer).toHaveBeenCalledOnce();
  });

  it('should propagate loadRenderer errors when eligible', async () => {
    const loadRenderer = vi.fn(async (): Promise<string> => {
      throw new Error('RENDERER_LOAD_FAILED');
    });
    await expect(admitThenLoad(makeInput(), profile, loadRenderer)).rejects.toThrow('RENDERER_LOAD_FAILED');
  });
});
