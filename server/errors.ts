/** An error the API can show the diner: a status, a stable code, and a sentence. Anything else becomes a 500 with no internals leaked. */
export class ApiError extends Error {
  constructor(public status: 400 | 404 | 409 | 413 | 429 | 503, public code: string, message: string, public details?: unknown) { super(message); this.name = 'ApiError'; }
}
