export interface WaitForOptions {
  /** Total time to keep retrying before throwing. Default 5000ms. */
  timeout?: number;
  /** Delay between attempts. Default 50ms. */
  interval?: number;
  /** Names the awaited condition in the timeout error, e.g. "the session id". */
  message?: string;
}

/** Poll `probe` until it returns a truthy value, then return that value.
 *
 *  This is the project's standard alternative to `page.waitForTimeout(ms)` for
 *  *condition* waits: never sleep a fixed guess hoping something is ready — poll
 *  for the thing itself, so a test is as fast as it can be and only as slow as
 *  it must be. A throw from `probe` is treated as "not ready yet" and retried,
 *  so it tolerates probes that read state which doesn't exist yet (including a
 *  `page.evaluate` whose context is torn down by a navigation mid-poll).
 *
 *  Playwright's `expect.poll(fn).toBe(x)` and `expect(fn).toPass()` already
 *  cover the retry-an-assertion case and should be preferred when you only need
 *  to *assert*. Reach for `waitFor` when you need the resolved value back — e.g.
 *  an id minted during app bootstrap — which the built-ins discard. */
export async function waitFor<T>(
  probe: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<NonNullable<T>> {
  const { timeout = 5000, interval = 50, message } = options;
  const deadline = Date.now() + timeout;
  let last = 'never returned a truthy value';
  for (;;) {
    try {
      const value = await probe();
      if (value) return value as NonNullable<T>;
      last = `returned ${JSON.stringify(value) ?? String(value)}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `waitFor: timed out after ${timeout}ms waiting for ${message ?? 'condition'} (last: ${last})`,
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
