import { describe, it, expect } from 'vitest';
import { httpStatusOf, isTransientError } from '../../src/ai/transientError';

describe('httpStatusOf', () => {
  it('reads a numeric .status (Anthropic SDK APIError shape)', () => {
    expect(httpStatusOf(Object.assign(new Error('overloaded'), { status: 529 }))).toBe(529);
    expect(httpStatusOf({ status: 429 })).toBe(429);
  });

  it('parses the leading status token from raw-fetch provider errors', () => {
    expect(httpStatusOf(new Error('OpenAI 500: internal error'))).toBe(500);
    expect(httpStatusOf(new Error('Gemini 503: service unavailable'))).toBe(503);
    expect(httpStatusOf(new Error('Custom 502: bad gateway'))).toBe(502);
  });

  it('returns null when there is no status', () => {
    expect(httpStatusOf(new Error('Failed to fetch'))).toBeNull();
    expect(httpStatusOf(new Error('something went wrong'))).toBeNull();
    expect(httpStatusOf('a bare string')).toBeNull();
  });
});

describe('isTransientError', () => {
  it('treats 429 + 5xx as transient', () => {
    expect(isTransientError(new Error('OpenAI 500: x'))).toBe(true);
    expect(isTransientError(new Error('Gemini 503: x'))).toBe(true);
    expect(isTransientError(new Error('OpenAI 429: rate limited'))).toBe(true);
    expect(isTransientError(Object.assign(new Error('overloaded'), { status: 529 }))).toBe(true);
    expect(isTransientError(new Error('Gemini 408: timeout'))).toBe(true);
  });

  it('treats 4xx auth/validation as fatal (not retried)', () => {
    expect(isTransientError(new Error('OpenAI 401: invalid api key'))).toBe(false);
    expect(isTransientError(new Error('OpenAI 400: bad request'))).toBe(false);
    expect(isTransientError(new Error('Gemini 403: forbidden'))).toBe(false);
    expect(isTransientError(new Error('OpenAI 404: model not found'))).toBe(false);
  });

  it('treats network / dropped-stream failures (no status) as transient', () => {
    expect(isTransientError(new Error('Failed to fetch'))).toBe(true);
    expect(isTransientError(new Error('NetworkError when attempting to fetch resource'))).toBe(true);
    expect(isTransientError(new Error('The stream was interrupted'))).toBe(true);
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
    expect(isTransientError(new Error('request timed out'))).toBe(true);
  });

  it('never retries a user/stop abort', () => {
    expect(isTransientError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
  });

  it('treats a missing-key / config error as fatal', () => {
    expect(isTransientError(new Error('OpenAI API key is required. Open AI Settings → OpenAI to connect one.'))).toBe(false);
    expect(isTransientError(new Error('No model is active. Open AI settings and choose a provider + model.'))).toBe(false);
  });
});
