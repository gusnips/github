# github-sdk

TypeScript client for the [GitHub REST API](https://docs.github.com/rest), generated from GitHub's OpenAPI description (`2022-11-28`). Zero runtime dependencies.

```bash
npm install github-sdk
# or
bun add github-sdk
```

## First call

Public endpoints work without a token (60 requests per hour per IP):

```ts
import { GitHubClient } from "github-sdk";

const github = new GitHubClient();

const user = await github.users.getByUsername("octocat");

console.log(user.login, user.public_repos);
```

Pass a personal access token, fine-grained token, or GitHub App installation token for private resources and the 5,000 requests per hour limit:

```ts
const github = new GitHubClient(process.env.GITHUB_TOKEN);

const repo = await github.repos.get("facebook", "react");

console.log(repo.full_name, repo.stargazers_count);
```

The client sends your token as `Authorization: Bearer YOUR_TOKEN`, along with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`.

## Finding the method you need

Every endpoint in GitHub's OpenAPI spec has an `operationId` shaped like `<group>/<method>`. The client turns the group into a property and the method into camelCase:

| GitHub endpoint                     | `operationId`                               | In the SDK                                                  |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `GET /users/{username}`             | `users/get-by-username`                     | `github.users.getByUsername(username)`                      |
| `GET /repos/{owner}/{repo}`         | `repos/get`                                 | `github.repos.get(owner, repo)`                             |
| `GET /users/{username}/repos`       | `repos/list-for-user`                       | `github.repos.listForUser(username, query?)`                |
| `POST /repos/{owner}/{repo}/issues` | `issues/create`                             | `github.issues.create(owner, repo, body)`                   |
| `GET /repos/{owner}/{repo}/pulls`   | `pulls/list`                                | `github.pulls.list(owner, repo, query?)`                    |
| `PUT /user/starred/{owner}/{repo}`  | `activity/star-repo-for-authenticated-user` | `github.activity.starRepoForAuthenticatedUser(owner, repo)` |
| `GET /search/repositories`          | `search/repos`                              | `github.search.repos({ q: "language:typescript" })`         |

Path parameters come first, in the order they appear in the URL. Next come the request body or query object, and then call options.

```ts
const pulls = await github.pulls.list("facebook", "react", {
  state: "open",
  per_page: 20,
});
```

All 47 groups (1,242 methods) from GitHub's OpenAPI description are included: `repos` (203), `actions` (200), `orgs` (107), `issues` (61), `codespaces` (48), `users` (47), `apps` (37), `activity` (34), `teams` (32), `copilot` (31), `agents` (30), `pulls` (30), `copilotSpaces` (28), `packages` (27), `projects` (26), `dependabot` (25), `codeScanning` (25), `migrations` (22), `codeSecurity` (20), `gists` (20), `secretScanning` (17), `interactions` (16), `reactions` (15), `billing` (13), `git` (13), `checks` (12), `securityAdvisories` (10), `agentAutomations` (10), `apiInsights` (9), `oidc` (8), `search` (7), `classroom` (6), `privateRegistries` (6), `hostedCompute` (6), `meta` (5), `agentTasks` (5), `campaigns` (5), `dependencyGraph` (5), `pullRequestStacks` (5), `codeQuality` (4), `licenses` (3), `codesOfConduct` (2), `gitignore` (2), `markdown` (2), `credentials` (1), `emojis` (1), and `rateLimit` (1).

Hover any method in your editor to read GitHub's summary and parameter types.

## Errors and rate limits

A non-2xx response throws `GitHubError`. It includes the HTTP `status`, the parsed `body`, the error `code` when GitHub sends one, and rate-limit headers:

```ts
import { GitHubError } from "github-sdk";

try {
  await github.repos.get("owner", "missing-repo");
} catch (error) {
  if (error instanceof GitHubError) {
    console.log(error.status); // 404
    console.log(error.message); // "Not Found"
    console.log(error.rateLimitRemaining); // from x-ratelimit-remaining
    console.log(error.rateLimitReset); // UTC epoch seconds from x-ratelimit-reset
    console.log(error.retryAfter); // seconds from retry-after, when present
  }
}
```

## Timeouts and custom headers

Pass an `AbortSignal` or extra headers in the last argument:

```ts
await github.repos.get("facebook", "react", {
  signal: AbortSignal.timeout(15_000),
});
```

## Configuration

```ts
new GitHubClient({
  token: process.env.GITHUB_TOKEN,
  baseUrl: "https://api.github.com", // or https://github.example.com/api/v3
  apiVersion: "2022-11-28",
  userAgent: "my-app/1.0.0",
  fetch: customFetch,
});
```

## Regenerating from `openapi.json`

The methods and types come from `openapi.json` in [github/rest-api-description](https://github.com/github/rest-api-description). To regenerate after updating `openapi.json`:

```bash
bun run generate
```

Do not edit `src/schema.d.ts`, `src/client.ts`, or `src/modules/` by hand.

## License

MIT. Not affiliated with GitHub.
