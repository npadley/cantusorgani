export type FetchDelay = (ms: number) => Promise<void>;
export const waitForRetry: FetchDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry transient fetch failures; callers retain their own status/error handling. */
export async function fetchWithRetry(
  fetchFn: (url: string) => Promise<Response>,
  url: string,
  delay: FetchDelay = waitForRetry,
  attempts = 2,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchFn(url);
      if (response.status < 500 || attempt >= attempts) return response;
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
    await delay(400);
  }
}
