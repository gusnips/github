export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatErrorItem(item: unknown): string | undefined {
  if (typeof item === "string" && item) return item;
  if (!isRecord(item)) return undefined;
  const field = typeof item.field === "string" ? item.field : undefined;
  const message = typeof item.message === "string" ? item.message : undefined;
  const code = typeof item.code === "string" ? item.code : undefined;
  if (field && message) return `${field}: ${message}`;
  if (field && code) return `${field}: ${code}`;
  return message ?? code;
}

function messageText(body: unknown): string | undefined {
  if (typeof body === "string") return body || undefined;
  if (!isRecord(body)) return undefined;
  const text = typeof body.message === "string" ? body.message : undefined;
  if (!text) return undefined;
  if (!Array.isArray(body.errors)) return text;
  const details = body.errors
    .map(formatErrorItem)
    .filter((entry): entry is string => Boolean(entry));
  return details.length ? `${text} (${details.join("; ")})` : text;
}

function errorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.code === "string") return body.code;
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (isRecord(item) && typeof item.code === "string") return item.code;
    }
  }
  return undefined;
}

function headerNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface GitHubErrorInit {
  retryAfter?: string | null;
  rateLimitRemaining?: string | null;
  rateLimitReset?: string | null;
  message?: string;
}

export class GitHubError extends Error {
  readonly status: number;
  /** A machine-readable error code when GitHub sends one, such as `missing_field`. */
  readonly code: string | undefined;
  readonly body: unknown;
  /** Seconds to wait before the next call when GitHub sent a `Retry-After` header. */
  readonly retryAfter: number | undefined;
  /** Calls left in the current rate-limit window from `x-ratelimit-remaining`. */
  readonly rateLimitRemaining: number | undefined;
  /** UTC epoch seconds when the rate-limit window resets from `x-ratelimit-reset`. */
  readonly rateLimitReset: number | undefined;

  constructor(status: number, body: unknown, init: GitHubErrorInit = {}) {
    super(
      init.message ??
        messageText(body) ??
        `GitHub request failed (HTTP ${status}). Check the request and your token.`,
    );
    this.name = "GitHubError";
    this.status = status;
    this.code = errorCode(body);
    this.body = body;
    this.retryAfter = headerNumber(init.retryAfter);
    this.rateLimitRemaining = headerNumber(init.rateLimitRemaining);
    this.rateLimitReset = headerNumber(init.rateLimitReset);
  }
}
