import { EXPORT_CEILING } from '../config';
import type { BudgetDecision, BudgetInput, ResourceLimits, ResourceProfile } from './types';

/**
 * Pure admission of layout jobs against a measured resource profile. No I/O:
 * the caller supplies the parsed profile (see parseResourceProfile) and the
 * renderer loader, so that rejection happens before any expensive work.
 */

const INVALID = (detail: string): Error => new Error(`INVALID_PROFILE: ${detail}`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw INVALID(`${field} must be a positive finite number`);
  }
  return value;
}

function parseLimits(value: unknown): ResourceLimits {
  if (!isRecord(value)) throw INVALID('limits must be an object');
  return {
    maxMeiBytes: positiveFinite(value.maxMeiBytes, 'limits.maxMeiBytes'),
    maxEvents: positiveFinite(value.maxEvents, 'limits.maxEvents'),
    maxPages: positiveFinite(value.maxPages, 'limits.maxPages'),
    jobTimeoutMs: positiveFinite(value.jobTimeoutMs, 'limits.jobTimeoutMs'),
  };
}

function parseMeasurement(value: unknown, index: number): { device: string; browser: string; date: string } {
  if (!isRecord(value)) throw INVALID(`measuredOn[${index}] must be an object`);
  const { device, browser, date } = value;
  if (typeof device !== 'string' || typeof browser !== 'string' || typeof date !== 'string') {
    throw INVALID(`measuredOn[${index}] must have string device, browser and date`);
  }
  return { device, browser, date };
}

/** Validates an untrusted resource profile (e.g. parsed JSON). Throws INVALID_PROFILE on anything malformed. */
export function parseResourceProfile(value: unknown): ResourceProfile {
  if (!isRecord(value)) throw INVALID('profile must be an object');
  const { version, provisional, limits, maxAggregateEvents, measuredOn, rendererDigest, fontDigest } = value;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw INVALID('version must be a positive integer');
  }
  if (typeof provisional !== 'boolean') throw INVALID('provisional must be a boolean');
  if (!Array.isArray(measuredOn)) throw INVALID('measuredOn must be an array');
  if (typeof rendererDigest !== 'string') throw INVALID('rendererDigest must be a string');
  if (typeof fontDigest !== 'string') throw INVALID('fontDigest must be a string');
  return {
    version,
    provisional,
    limits: parseLimits(limits),
    maxAggregateEvents: positiveFinite(maxAggregateEvents, 'maxAggregateEvents'),
    measuredOn: measuredOn.map(parseMeasurement),
    rendererDigest,
    fontDigest,
  };
}

function mebibytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MiB`;
}

/**
 * Checks in order and returns the first failure. Values exactly at a limit are
 * eligible. The source-system ceiling is EXPORT_CEILING, independent of the profile.
 */
export function checkLayoutBudget(input: BudgetInput, profile: ResourceProfile): BudgetDecision {
  const { limits } = profile;
  if (input.sourceSystems > EXPORT_CEILING) {
    return { eligible: false, code: 'SOURCE_CEILING', limit: `${EXPORT_CEILING} source systems` };
  }
  if (input.meiBytes.some((bytes) => bytes > limits.maxMeiBytes)) {
    return { eligible: false, code: 'BUDGET_EXCEEDED', limit: `${mebibytes(limits.maxMeiBytes)} per part` };
  }
  if (input.eventCounts.some((count) => count > limits.maxEvents)) {
    return { eligible: false, code: 'BUDGET_EXCEEDED', limit: `${limits.maxEvents} events per part` };
  }
  const aggregate = input.eventCounts.reduce((sum, count) => sum + count, 0);
  if (aggregate > profile.maxAggregateEvents) {
    return { eligible: false, code: 'BUDGET_EXCEEDED', limit: `${profile.maxAggregateEvents} events per selection` };
  }
  if (input.predictedPages > limits.maxPages) {
    return { eligible: false, code: 'BUDGET_EXCEEDED', limit: `${limits.maxPages} pages per selection` };
  }
  return { eligible: true };
}

export type Admission<T> =
  | { readonly eligible: false; readonly code: 'BUDGET_EXCEEDED' | 'SOURCE_CEILING'; readonly limit: string }
  | { readonly eligible: true; readonly renderer: T };

/**
 * Runs the budget check and calls loadRenderer only when the job is eligible.
 * A rejected job never reaches the (expensive) renderer load.
 */
export async function admitThenLoad<T>(
  input: BudgetInput,
  profile: ResourceProfile,
  loadRenderer: () => Promise<T>,
): Promise<Admission<T>> {
  const decision = checkLayoutBudget(input, profile);
  if (!decision.eligible) return decision;
  return { eligible: true, renderer: await loadRenderer() };
}
