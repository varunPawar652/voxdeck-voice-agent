import { describe, expect, it } from 'vitest';
import { describeCallFailure } from '../src/lib/realtimeConnection.ts';

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? 'not json' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('describeCallFailure', () => {
  it('explains an exhausted credit balance', async () => {
    const msg = await describeCallFailure(res(429, { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'You have no credits remaining.' } }));
    expect(msg).toMatch(/no API credits/);
  });

  it('treats other 429s as rate limiting', async () => {
    expect(await describeCallFailure(res(429, { error: { code: 'rate_limit_exceeded' } }))).toMatch(/rate limit/);
  });

  it('explains an expired credential', async () => {
    expect(await describeCallFailure(res(401, { error: { code: 'invalid_api_key' } }))).toMatch(/expired/);
  });

  it('falls back to the status and code, tolerating non-JSON bodies', async () => {
    expect(await describeCallFailure(res(500, { error: { code: 'server_error' } }))).toBe('The Realtime API refused the call (HTTP 500: server_error).');
    expect(await describeCallFailure(res(502))).toBe('The Realtime API refused the call (HTTP 502).');
  });
});
