import { describe, expect, test } from "bun:test";
import { GitHubClient } from "./client";
import { GitHubError } from "./errors";
import type { GitHubFetch } from "./http";

function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function mockFetch(handler: (request: Request) => Response) {
  const requests: Request[] = [];
  const fetch: GitHubFetch = async (request) => {
    requests.push(request.clone());
    return handler(request);
  };
  return { fetch, requests };
}

function clientFor(
  handler: (request: Request) => Response,
  token: string | undefined = "ghp_test",
) {
  const mock = mockFetch(handler);
  const github = new GitHubClient({
    token,
    fetch: mock.fetch,
  });
  return { github, requests: mock.requests };
}

describe("GitHubClient", () => {
  test("calls public endpoints without a token and sets the GitHub headers", async () => {
    const mock = mockFetch(() =>
      json({ login: "octocat", id: 1, type: "User" }),
    );
    const github = new GitHubClient({ fetch: mock.fetch });

    const user = await github.users.getByUsername("octocat");

    expect(user.login).toBe("octocat");
    expect(mock.requests).toHaveLength(1);
    const req = mock.requests[0];
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.github.com/users/octocat");
    expect(req.headers.get("accept")).toBe("application/vnd.github+json");
    expect(req.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(req.headers.get("authorization")).toBeNull();
  });

  test("accepts a token string or config object and encodes path and query parameters", async () => {
    const shortClient = new GitHubClient("ghp_short");
    const defaultClient = new GitHubClient();
    expect(shortClient.repos).toBeDefined();
    expect(defaultClient.users).toBeDefined();

    const mock = mockFetch(() => json([]));
    const github = new GitHubClient({
      token: "ghp_secret",
      userAgent: "socially-test/1.0",
      apiVersion: "2022-11-28",
      fetch: mock.fetch,
    });

    await github.repos.listForUser("octo+cat", {
      type: "owner",
      per_page: 25,
      page: undefined,
    });

    const req = mock.requests[0];
    const url = new URL(req.url);
    expect(req.headers.get("authorization")).toBe("Bearer ghp_secret");
    expect(req.headers.get("user-agent")).toBe("socially-test/1.0");
    expect(url.pathname).toBe("/users/octo%2Bcat/repos");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: "owner",
      per_page: "25",
    });
  });

  test("sends JSON bodies on POST and PATCH and types the response", async () => {
    const { github, requests } = clientFor(() =>
      json({ id: 42, number: 7, title: "Bug report", state: "open" }, 201),
    );

    const issue = await github.issues.create("gusnips", "github", {
      title: "Bug report",
      body: "Steps to reproduce",
      labels: ["bug"],
    });

    const number: number = issue.number;
    expect(number).toBe(7);
    expect(requests[0].method).toBe("POST");
    expect(new URL(requests[0].url).pathname).toBe(
      "/repos/gusnips/github/issues",
    );
    expect(requests[0].headers.get("content-type")).toBe("application/json");
    expect(await requests[0].json()).toEqual({
      title: "Bug report",
      body: "Steps to reproduce",
      labels: ["bug"],
    });
  });

  test("returns undefined on 204 No Content without parsing JSON", async () => {
    const { github, requests } = clientFor(
      () => new Response(null, { status: 204 }),
    );

    const starred = await github.activity.starRepoForAuthenticatedUser(
      "gusnips",
      "github",
    );
    const unstarred = await github.activity.unstarRepoForAuthenticatedUser(
      "gusnips",
      "github",
    );

    expect(starred).toBeUndefined();
    expect(unstarred).toBeUndefined();
    expect(requests[0].method).toBe("PUT");
    expect(requests[1].method).toBe("DELETE");
    expect(new URL(requests[0].url).pathname).toBe(
      "/user/starred/gusnips/github",
    );
  });

  test("supports raw text and binary upload endpoints", async () => {
    const { github, requests } = clientFor((request) =>
      request.url.endsWith("/markdown/raw")
        ? new Response("<p>Hello</p>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          })
        : json({ id: 99, name: "release.zip", state: "uploaded" }, 201),
    );

    const htmlResponse = await github.markdown.renderRaw("# Hello");
    const asset = await github.repos.uploadReleaseAsset(
      "gusnips",
      "github",
      12,
      { name: "release.zip" },
      new Blob(["zip-bytes"]),
    );

    expect(await htmlResponse.text()).toBe("<p>Hello</p>");
    expect(requests[0].headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await requests[0].text()).toBe("# Hello");
    expect(asset.name).toBe("release.zip");
    expect(requests[1].headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(new URL(requests[1].url).searchParams.get("name")).toBe(
      "release.zip",
    );
  });

  test("throws GitHubError with validation details and rate-limit headers", async () => {
    const errorBody = {
      message: "Validation Failed",
      errors: [
        {
          resource: "Issue",
          field: "title",
          code: "missing_field",
        },
      ],
      documentation_url:
        "https://docs.github.com/rest/issues/issues#create-an-issue",
    };
    const { github } = clientFor(() =>
      json(errorBody, 422, {
        "Retry-After": "60",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "1761523200",
      }),
    );

    const error = await github.issues
      .create("gusnips", "github", { title: "" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("missing_field");
    expect(error.message).toBe("Validation Failed (title: missing_field)");
    expect(error.retryAfter).toBe(60);
    expect(error.rateLimitRemaining).toBe(0);
    expect(error.rateLimitReset).toBe(1761523200);
    expect(error.body).toEqual(errorBody);
  });

  test("throws GitHubError when a 200 JSON endpoint answers with non-JSON", async () => {
    const { github } = clientFor(
      () =>
        new Response("<html>502</html>", {
          status: 200,
          headers: {
            "X-RateLimit-Remaining": "4999",
            "X-RateLimit-Reset": "1761523200",
          },
        }),
    );

    const error = await github.users
      .getByUsername("octocat")
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.message).toBe(
      "GitHub answered with something that is not JSON.",
    );
    expect(error.rateLimitRemaining).toBe(4999);
    expect(error.rateLimitReset).toBe(1761523200);
  });
});
