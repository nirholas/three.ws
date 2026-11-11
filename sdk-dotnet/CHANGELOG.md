# Changelog

All notable changes to `ThreeWs.Sdk` are recorded here. The package follows [Semantic Versioning](https://semver.org/).

## 1.0.0 (2026-11-11)

First release.

- `ThreeWsClient` for `net8.0` and `netstandard2.1`. It can own its `HttpClient` or take one from `IHttpClientFactory`.
- System.Text.Json source-generated serialization, so no reflection, and trimming, Native AOT and IL2CPP work.
- Authentication with an API key, a fixed OAuth access token, or a per-request token provider. Credentials are sent only to the configured origin.
- Jittered exponential retries on 429 and 5xx that honour `Retry-After`. POST requests retry only when they carry an idempotency key.
- Typed exceptions (`ThreeWsApiException`, `ThreeWsAuthenticationException`, `ThreeWsRateLimitException`, `ThreeWsNotFoundException`, `ThreeWsJobFailedException`) carrying the API's error code, request id and `Retry-After`.
- Forge:
  - catalog of paths, tiers and lanes;
  - create, poll, wait and generate on every lane, with an automatic `Idempotency-Key`;
  - auto-rigging;
  - streaming GLB download with a format check;
  - the free Studio lane;
  - model page and viewer links.
- Catalog: search, paged `IAsyncEnumerable` search over every match, and item detail with code snippets.
- Agents: public directory, profile, your own agents, idempotent create, and streaming chat as `IAsyncEnumerable<AgentChatEvent>`.
- MCP: tool listing with pagination and tool calls on the free studio server and the account server, over JSON or SSE.
- Auth: `WhoAmIAsync`.
- Samples: a console quickstart, and a Unity sample with glTFast, a DLL export script and an IL2CPP `link.xml`.
