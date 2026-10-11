/**
 * Privacy-safe export analytics using GoatCounter.
 * Records export events without sending personal data.
 */

// Minimal typed global for window.goatcounter
interface GoatCounterEvent {
  path: string;
  title?: string;
  event?: boolean;
}

interface GoatCounterAPI {
  count(event: GoatCounterEvent): void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounterAPI;
  }
}

// Allowed keys for analytics (non-personal data only)
const ALLOWED_KEYS = new Set<string>([
  "page",
  "orientation",
  "staff",
  "maxSystems",
  "linePolicy",
  "paper",
]);

/**
 * Track an export event with privacy-safe details.
 *
 * @param kind - Type of export: 'quick' or 'custom'
 * @param details - Export details (only allowed keys are sent)
 *
 * Sends no personal data. Only the keys page, orientation, staff, maxSystems,
 * linePolicy and paper are allowed. Unknown keys are silently dropped.
 *
 * This function never throws, even if GoatCounter is unavailable or throws.
 */
export function trackExport(
  kind: "quick" | "custom",
  details: Readonly<Record<string, string>>
): void {
  try {
    // Filter to only allowed keys
    const filteredDetails: Record<string, string> = {};
    for (const key of Object.keys(details).sort()) {
      if (ALLOWED_KEYS.has(key)) {
        const value = details[key];
        if (value !== undefined) {
          filteredDetails[key] = value;
        }
      }
    }

    // Build title as sorted "k=v" pairs joined with ", "
    const sortedKeys = Object.keys(filteredDetails).sort();
    const title = sortedKeys.map((k) => `${k}=${filteredDetails[k]}`).join(", ");

    // Call goatcounter if available
    window.goatcounter?.count({
      path: `export/${kind}`,
      title,
      event: true,
    });
  } catch {
    // Never throw, silently fail
  }
}
