import { apiErrorSchema, createSessionResponseSchema, type CreateSessionResponse } from '@voxdeck/shared';

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Asks our backend for a short-lived Realtime credential. The real API key never leaves the server. */
export async function requestSession(currentSlide: number, signal?: AbortSignal): Promise<CreateSessionResponse> {
  let res: Response;
  try {
    res = await fetch('/api/realtime/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSlide }),
      signal,
    });
  } catch {
    throw new ApiRequestError('Cannot reach the VoxDeck server. Is it running on port 3001?', 'server_unreachable');
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(parsed.data.error.message, parsed.data.error.code)
      : new ApiRequestError(`The server returned HTTP ${res.status}.`, 'http_error');
  }
  const parsed = createSessionResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiRequestError('The server returned an unexpected session response.', 'bad_response');
  return parsed.data;
}
