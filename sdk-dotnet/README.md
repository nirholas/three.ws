# ThreeWs.Sdk

The official .NET SDK for [three.ws](https://three.ws). It turns text and images into 3D models (GLB) on every Forge lane, searches the free 3D asset catalog, auto-rigs meshes, chats with three.ws agents as a stream, and lists MCP tools.

- Targets `net8.0` (servers, tools, ASP.NET Core) and `netstandard2.1` (Unity 2021.2+, Xamarin, older runtimes).
- System.Text.Json **source generation**: no reflection, so it is trimming, Native AOT and IL2CPP friendly.
- Accepts your own `HttpClient`, so it works with `IHttpClientFactory`.
- Every call takes a `CancellationToken`.
- Retries 429 and 5xx with jittered exponential backoff and honours `Retry-After`.
- Every create call sends an `Idempotency-Key`, so a retry never starts a second generation.
- Failures throw typed exceptions that carry the API's error code.

Full guide: [three.ws/docs/dotnet-sdk](https://three.ws/docs/dotnet-sdk). Unity sample: [samples/unity](samples/unity/README.md).

## Install

```bash
dotnet add package ThreeWs.Sdk
```

## Quickstart

Text to a GLB file on the free lane, with no account or key:

```csharp
using ThreeWs.Sdk;
using ThreeWs.Sdk.Forge;

using var client = new ThreeWsClient();
var model = await client.Forge.StudioGenerateAndWaitAsync("a brass desk lamp", ForgeTiers.Draft);
await using var file = File.Create("lamp.glb");
var bytes = await client.Forge.DownloadAsync(model.GlbUrl!, file);
Console.WriteLine($"{bytes:N0} bytes from {model.GlbUrl}");
Console.WriteLine($"View it: {model.ViewerUrl}");
```

A runnable version that also shows the catalog, MCP and agent chat is in [samples/Quickstart](samples/Quickstart/Program.cs):

```bash
dotnet run --project samples/Quickstart -- "a brass desk lamp" lamp.glb
```

## Authentication

Free surfaces (the Studio lane, the free Forge lanes, the catalog, public agents, agent chat and the free MCP server) need no credentials. Account surfaces (your own agents, `whoami`, the account MCP server, paid tiers) need one of these:

```csharp
// An API key from https://three.ws/dashboard/api (starts with sk_live_). Keep it server-side.
var client = new ThreeWsClient(new ThreeWsClientOptions { ApiKey = "sk_live_..." });

// A fixed OAuth access token.
var client = new ThreeWsClient(new ThreeWsClientOptions { AccessToken = token });

// A token provider called before every request, so refreshed tokens are picked up. It wins over the other two.
var client = new ThreeWsClient(new ThreeWsClientOptions
{
    AccessTokenProvider = async ct => await tokenCache.GetAsync(ct),
});
```

Every credential is sent as `Authorization: Bearer <value>`, and only to the configured `BaseUrl` origin: a GLB download from another host never receives it. Calling an account endpoint without credentials throws `ThreeWsAuthenticationException` with `ErrorCode == "unauthorized"`.

## IHttpClientFactory

```csharp
builder.Services.AddHttpClient<ThreeWsClient>((http, sp) =>
    new ThreeWsClient(http, new ThreeWsClientOptions { ApiKey = builder.Configuration["ThreeWs:ApiKey"] }));
```

When you pass an `HttpClient`, the SDK never disposes it and ignores its `BaseAddress` (set `ThreeWsClientOptions.BaseUrl` instead). Raise the client's `Timeout` above the default 100 seconds if you call `WaitAsync` through one request pipeline; the SDK's own client has no timeout, so cancel with a token.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `BaseUrl` | `https://three.ws` | API origin. Point it at a self-hosted or staging deployment. |
| `ApiKey` | none | API key, sent as a bearer token. |
| `AccessToken` | none | OAuth access token. Wins over `ApiKey`. |
| `AccessTokenProvider` | none | Called per request for a fresh token. Wins over both. |
| `MaxRetries` | `3` | Retries after the first attempt for 429, 5xx and network errors. `0` disables. |
| `RetryBaseDelay` | 500 ms | Base of the exponential backoff. Each wait is a random value up to `base * 2^attempt` (full jitter). |
| `RetryMaxDelay` | 30 s | Cap on any single wait, including a server `Retry-After`. |
| `UserAgentSuffix` | none | Appended to `ThreeWs.Sdk/<version>` so your traffic is identifiable. |

Every request retries on 429 and 503, which mean the work never ran. Other 5xx answers (except 501) and network failures retry only for GET requests and for requests that carry an idempotency key (every create call does), so a retry can never duplicate work.

## Errors

| Exception | When | Useful members |
| --- | --- | --- |
| `ThreeWsApiException` | Any non-2xx response. Base class of the next three. | `StatusCode`, `ErrorCode` (the API's `error` field, for example `invalid_glb_url`), `Message`, `RequestId`, `RetryAfter`, `ResponseBody` |
| `ThreeWsAuthenticationException` | 401 or 403 | as above |
| `ThreeWsRateLimitException` | 429 after the retries ran out | `RetryAfter` |
| `ThreeWsNotFoundException` | 404 | as above |
| `ThreeWsJobFailedException` | A Forge job ended `failed` | `Job` (with `Error` and `RetryBackends`, the lanes the server suggests trying next) |

```csharp
try
{
    await client.Forge.RigAsync(url);
}
catch (ThreeWsApiException ex) when (ex.ErrorCode == "invalid_glb_url")
{
    Console.WriteLine($"Host the mesh publicly first: {ex.Message}");
}
```

## Methods

### Forge (`client.Forge`)

| Method | Endpoint | What it does |
| --- | --- | --- |
| `GetCatalogAsync(ct)` | `GET /api/forge?catalog` | Paths, tiers (with USDC prices) and every lane, each flagged `Free`, `Configured` and `ByoKey`. |
| `CreateAsync(ForgeRequest, ct)` | `POST /api/forge` | Starts a generation and returns the queued (or cached, done) job. Sends `ForgeRequest.IdempotencyKey`, or a fresh key. |
| `GetJobAsync(jobId, ct)` | `GET /api/forge?job=` | One status read for a generation or rig job. |
| `WaitAsync(jobId, progress?, ct)` | polls the above | Polls at half the server's remaining-time estimate (2 to 15 s) until done. Throws `ThreeWsJobFailedException` on failure. |
| `GenerateAsync(ForgeRequest, progress?, ct)` | create, then wait | The one-call form. |
| `RigAsync(glbUrl, idempotencyKey?, ct)` | `POST /api/forge?action=rig` | Adds a humanoid skeleton to a public GLB. Returns a job for `WaitAsync`. |
| `DownloadAsync(glbUrl, Stream, ct)` | the GLB URL | Streams the model into any `Stream` and returns the byte count. Checks the `glTF` magic so an error page is never saved as a model. Relative URLs resolve against `BaseUrl`. |
| `StudioGenerateAsync(prompt, tier?, ct)` | `POST /api/3d/studio` | The free, keyless Studio lane: one call, viewer and AR links included. |
| `StudioGetJobAsync(jobOrPollPath, ct)` | `GET /api/3d/studio?job=` | One poll of a pending Studio job. |
| `StudioGenerateAndWaitAsync(prompt, tier?, progress?, ct)` | both | Generate and poll until done. |
| `ModelPageUrl(creationId)` | | The public model page, `https://three.ws/m/<id>`. |
| `ViewerUrl(glbUrl)` | | A shareable browser viewer for any public GLB. |

`ForgeRequest` fields: `Prompt`, `ImageUrls` (image to 3D), `Path` (`ForgePaths.Image`, `Geometry`, `Sketch`), `Tier` (`ForgeTiers.Draft`, `Standard`, `High`), `Backend` (a lane id from the catalog), `Seed`, `OutputFormat` (`ForgeOutputFormats.Glb`, `GlbDraco`, `GlbMeshopt`), `TextureSize`, `TargetPolycount`, `Director`, `ForceRegenerate`, `ProviderKey` (your own key for a bring-your-own-key lane, sent as a header), `IdempotencyKey`.

Pick a lane by reading the catalog rather than hard-coding one:

```csharp
var catalog = await client.Forge.GetCatalogAsync(ct);
var lane = catalog.Backends.First(b => b.Free && b.Configured && b.Paths.Contains(ForgePaths.Image));
var job = await client.Forge.GenerateAsync(
    new ForgeRequest { Prompt = "a low-poly fox", Tier = ForgeTiers.Draft, Backend = lane.Id },
    new Progress<ForgeJob>(j => Console.WriteLine($"{j.Status} {j.EtaRemainingSeconds}s")),
    ct);
await using var glb = File.Create("fox.glb");
await client.Forge.DownloadAsync(job.GlbUrl!, glb, ct);
```

A job that fails with `Retryable == true` lists lanes to try next in `RetryBackends`; resubmit with `Backend` set to one of them.

### Catalog (`client.Catalog`)

Free, keyless search over the three.ws catalog of CC0 props, rigged characters and motion clips.

| Method | Endpoint | What it does |
| --- | --- | --- |
| `SearchAsync(CatalogQuery?, ct)` | `GET /api/catalog` | One page of results, with facets and the total. Filters: `Query`, `Kind` (`CatalogKinds.Model`, `Avatar`, `Animation`), `Category`, `Tag`, `Limit`, `Offset`. |
| `SearchAsync(text, kind?, limit?, ct)` | same | The short form. |
| `SearchAllAsync(CatalogQuery?, ct)` | same, paged | `IAsyncEnumerable<CatalogItem>` over every match, fetching pages as you iterate. |
| `GetAsync(id, ct)` | `GET /api/catalog?id=` | One asset with links, related assets and paste-ready code snippets. Throws `ThreeWsNotFoundException` for an unknown id. |

```csharp
await foreach (var item in client.Catalog.SearchAllAsync(new CatalogQuery { Query = "chair", Kind = CatalogKinds.Model }, ct))
    Console.WriteLine($"{item.Name}: {item.Url}");
```

### Agents (`client.Agents`)

| Method | Endpoint | Auth | What it does |
| --- | --- | --- | --- |
| `ListPublicAsync(PublicAgentQuery?, ct)` | `GET /api/agents/public` | none | The public agent directory. Filters: `Query`, `Skill`, `Sort`, `Limit`, `Before` (cursor). |
| `GetAsync(agentId, ct)` | `GET /api/agents/:id` | none | One agent's public profile. |
| `ListMineAsync(limit?, cursor?, ct)` | `GET /api/v1/agents` | key or token | The agents your account owns. |
| `CreateAsync(CreateAgentRequest, ct)` | `POST /api/v1/agents` | key or token | Creates an agent (`Name`, `Persona`, `SystemPrompt`, `Model`, `Temperature`, `Skills`). Idempotent. |
| `MessageStreamAsync(AgentMessageRequest, ct)` | `POST /api/chat` (SSE) | none | `IAsyncEnumerable<AgentChatEvent>`: `Chunk` events with `Text`, then one `Done` with the full `Reply`. An `error` event throws `ThreeWsApiException`. |
| `MessageStreamAsync(agentId, message, ct)` | same | none | The short form. |
| `MessageAsync(AgentMessageRequest, ct)` | same | none | Waits for the stream to finish and returns the `Done` event. |

```csharp
await foreach (var ev in client.Agents.MessageStreamAsync(agentId, "What can you build for me?", ct))
{
    if (ev.Type == AgentChatEventType.Chunk) Console.Write(ev.Text);
}
```

`AgentMessageRequest` also takes `History` (a list of `ChatTurn` with `Role` and `Content`) for multi-turn chat, plus `Context`, `Provider` and `Model`.

### MCP (`client.Mcp`)

| Method | What it does |
| --- | --- |
| `ListToolsAsync(endpoint = McpEndpoints.Studio, ct)` | Every tool on the server, following `nextCursor` pages. |
| `CallToolAsync(name, JsonElement? arguments, endpoint = McpEndpoints.Studio, ct)` | Calls one tool and returns its content blocks and structured content. |

`McpEndpoints.Studio` (`/api/mcp-studio`) is the free 3D server. `McpEndpoints.Account` (`/mcp`) is the full account server and needs credentials. Both speak MCP Streamable HTTP; the SDK reads JSON and SSE replies. To wire three.ws into an MCP client instead, see [three.ws/docs/mcp](https://three.ws/docs/mcp).

### Auth (`client.Auth`)

| Member | What it does |
| --- | --- |
| `HasCredentials` | True when a key, token or token provider is configured. |
| `WhoAmIAsync(ct)` | `GET /api/v1/me`: the account behind the credential and its scopes. |

## Unity

The `netstandard2.1` build runs in Unity 2021.2 and later, including IL2CPP players. [samples/unity](samples/unity/README.md) has a MonoBehaviour that generates a model from a prompt and spawns it with glTFast, the DLL export script, and the `link.xml` for managed code stripping.

## Building from source

```bash
cd sdk-dotnet
dotnet build -c Release
dotnet test tests/ThreeWs.Sdk.Tests -c Release                              # against the net8.0 build
dotnet test tests/ThreeWs.Sdk.Tests -c Release -p:SdkTarget=netstandard2.1  # against the netstandard2.1 build
dotnet pack src/ThreeWs.Sdk -c Release -o artifacts
```

The tests call the real production API. They generate one model per lane, so a full run takes several minutes. Set `THREE_WS_API_KEY` to also exercise the authenticated calls; without it those tests assert the documented `401 unauthorized` shape. `THREE_WS_BASE_URL` points the suite at another deployment.

## License

Apache-2.0. See [CHANGELOG.md](CHANGELOG.md) for release notes.
