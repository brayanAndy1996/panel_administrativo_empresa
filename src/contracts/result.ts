export type Result<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; fields?: Record<string, string[]>; retryAfterMs?: number }; requestId: string };

export function failure<T = never>(code: string, message: string, requestId: string): Result<T> {
  return { ok: false, error: { code, message }, requestId };
}
