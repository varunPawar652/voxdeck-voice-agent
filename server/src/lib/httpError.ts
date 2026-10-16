/** An error that is safe to show to the browser. `message` must never contain secrets. */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
