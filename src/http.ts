import { GitHubError } from "./errors";
import type { paths } from "./schema";

const DEFAULT_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2022-11-28";

export type GitHubFetch = (request: Request) => Promise<Response>;

export interface GitHubConfig {
  /** Personal access token, GitHub App installation token, or fine-grained token. Optional for public endpoints. */
  token?: string;
  /** `https://api.github.com` by default. Point this at `/api/v3` on a GitHub Enterprise Server host. */
  baseUrl?: string;
  /** Sent as `X-GitHub-Api-Version`. Defaults to `2022-11-28`. */
  apiVersion?: string;
  /** Optional `User-Agent` header value. */
  userAgent?: string;
  fetch?: GitHubFetch;
}

/** Pass `AbortSignal.timeout(30_000)` to stop waiting after 30 seconds. */
export interface CallOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type Method = "get" | "post" | "put" | "patch" | "delete";

type Operation<P extends keyof paths, M extends Method> = NonNullable<
  paths[P][M]
>;

/** The values that fill the `{...}` parts of one endpoint's path. */
export type PathParams<P extends keyof paths, M extends Method> =
  Operation<P, M> extends { parameters: { path: infer T } } ? T : never;

/** The query string of one endpoint. */
export type Query<P extends keyof paths, M extends Method> =
  Operation<P, M> extends { parameters: { query?: infer T } }
    ? NonNullable<T>
    : never;

/** What one endpoint takes in its body. */
export type Body<P extends keyof paths, M extends Method> =
  Operation<P, M> extends { requestBody?: { content: infer C } }
    ? C extends Record<string, unknown>
      ? C[keyof C]
      : never
    : never;

type SuccessStatus = 200 | 201 | 202 | 204 | 205 | 207;

type StatusData<R> = R extends { content: { "application/json": infer D } }
  ? D
  : R extends { content?: never }
    ? undefined
    : never;

/** What one endpoint answers when the call succeeds, as GitHub's OpenAPI description types it. */
export type Data<P extends keyof paths, M extends Method> =
  Operation<P, M> extends { responses: infer R }
    ? {
        [S in SuccessStatus & keyof R]: StatusData<R[S]>;
      }[SuccessStatus & keyof R]
    : never;

interface Args {
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  json?: unknown;
  text?: string;
  binary?: Blob;
}

function readBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fill(
  path: string,
  params: Record<string, string | number> = {},
): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`The path needs ${name}.`);
    return encodeURIComponent(String(value));
  });
}

function appendQuery(
  params: URLSearchParams,
  query: Record<string, unknown> | undefined,
): void {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
    } else {
      params.append(key, String(value));
    }
  }
}

// ponytail: the answer's type comes from GitHub's OpenAPI file and is not checked at run time,
// as with openapi-fetch. Upgrade path: validate with a schema library if answers drift from the spec.
export class Transport {
  constructor(private readonly config: GitHubConfig = {}) {}

  async send<P extends keyof paths, M extends Method>(
    method: M,
    path: P,
    args: Args,
    options?: CallOptions,
  ): Promise<Data<P, M>> {
    const response = await this.call(method, path, args, options);
    const text = await response.text();
    if (response.status === 204 || response.status === 205 || !text) {
      return undefined as Data<P, M>;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new GitHubError(response.status, text, {
        message: "GitHub answered with something that is not JSON.",
        retryAfter: response.headers.get("retry-after"),
        rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
        rateLimitReset: response.headers.get("x-ratelimit-reset"),
      });
    }
  }

  /** For endpoints that return raw text, HTML, or an archive stream. Read the content from the Response. */
  download<P extends keyof paths, M extends Method>(
    method: M,
    path: P,
    args: Args,
    options?: CallOptions,
  ): Promise<Response> {
    return this.call(method, path, args, options);
  }

  private async call(
    method: Method,
    path: string,
    args: Args,
    options?: CallOptions,
  ): Promise<Response> {
    const base = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const url = new URL(`${base}${fill(path, args.path)}`);
    appendQuery(url.searchParams, args.query);

    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": this.config.apiVersion ?? DEFAULT_API_VERSION,
    });
    if (this.config.token) {
      headers.set("Authorization", `Bearer ${this.config.token}`);
    }
    if (this.config.userAgent) {
      headers.set("User-Agent", this.config.userAgent);
    }
    let body: string | Blob | undefined;
    if (args.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(args.json);
    } else if (args.text !== undefined) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      body = args.text;
    } else if (args.binary !== undefined) {
      headers.set("Content-Type", "application/octet-stream");
      body = args.binary;
    }
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }

    const request = new Request(url, {
      method: method.toUpperCase(),
      headers,
      body,
      signal: options?.signal,
    });
    const response = await (this.config.fetch ?? fetch)(request);
    if (!response.ok) {
      throw new GitHubError(response.status, readBody(await response.text()), {
        retryAfter: response.headers.get("retry-after"),
        rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
        rateLimitReset: response.headers.get("x-ratelimit-reset"),
      });
    }
    return response;
  }
}
