# .NET SDK (NuGet, Unity)

`ThreeWs.Sdk` is the official .NET client for three.ws. Use it from C# to:

- generate 3D models (GLB) from text or images on every Forge lane, and download them;
- search the free asset catalog;
- auto-rig a mesh;
- chat with three.ws agents as a stream;
- list and call MCP tools.

It ships one package with two builds:

- `net8.0` for ASP.NET Core services, workers and tools;
- `netstandard2.1` for Unity 2021.2 and later, including IL2CPP players.

Source: [`sdk-dotnet/`](https://github.com/nirholas/three.ws/tree/main/sdk-dotnet). It is open source under Apache-2.0.

## Install

```bash
dotnet add package ThreeWs.Sdk
```

## Ten lines to a 3D model

The free Studio lane needs no account and no key:

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

A draft model usually arrives in under a minute. `model.ViewerUrl` opens it in the browser, and `model.ArUrl` places it in your room.

## What the client covers

| Area | Members | Credentials |
| --- | --- | --- |
| `client.Forge` | `GetCatalogAsync`, `CreateAsync`, `GetJobAsync`, `WaitAsync`, `GenerateAsync`, `RigAsync`, `DownloadAsync`, `StudioGenerateAsync`, `StudioGetJobAsync`, `StudioGenerateAndWaitAsync`, `ModelPageUrl`, `ViewerUrl` | none on free lanes |
| `client.Catalog` | `SearchAsync`, `SearchAllAsync` (`IAsyncEnumerable` over every page), `GetAsync` | none |
| `client.Agents` | `ListPublicAsync`, `GetAsync`, `MessageStreamAsync` (`IAsyncEnumerable`), `MessageAsync` | none |
| `client.Agents` | `ListMineAsync`, `CreateAsync` | API key or OAuth token |
| `client.Mcp` | `ListToolsAsync`, `CallToolAsync`, on the free studio server (`/api/mcp-studio`) or the account server (`/mcp`) | the account server needs one |
| `client.Auth` | `HasCredentials`, `WhoAmIAsync` | API key or OAuth token |

The [SDK README](https://github.com/nirholas/three.ws/blob/main/sdk-dotnet/README.md#methods) lists every method with its endpoint and parameters.

## Generating on a specific Forge lane

The Forge catalog says which lanes are free and live right now, so read it instead of hard-coding a lane:

```csharp
var catalog = await client.Forge.GetCatalogAsync(ct);
var lane = catalog.Backends.First(b => b.Free && b.Configured && b.Paths.Contains(ForgePaths.Image));

var job = await client.Forge.GenerateAsync(
    new ForgeRequest { Prompt = "a low-poly fox", Tier = ForgeTiers.Draft, Backend = lane.Id },
    new Progress<ForgeJob>(j => Console.WriteLine($"{j.Status}, about {j.EtaRemainingSeconds}s left")),
    ct);

await using var glb = File.Create("fox.glb");
await client.Forge.DownloadAsync(job.GlbUrl!, glb, ct);
```

`GenerateAsync` creates the job, then polls at half the server's remaining-time estimate, clamped to 2 to 15 seconds. When a job fails, `ThreeWsJobFailedException.Job.RetryBackends` names the lanes the server suggests trying next. For image to 3D, set `ImageUrls` instead of, or as well as, `Prompt`. For a bring-your-own-key lane, set `ProviderKey`.

To rig the result, call `client.Forge.RigAsync(job.GlbUrl!)` and pass the returned job id to `WaitAsync`. The GLB URL must be publicly reachable: a loopback, private-range or cloud-metadata host is refused with `invalid_glb_url`.

## Streaming agent chat

```csharp
await foreach (var ev in client.Agents.MessageStreamAsync(agentId, "What can you build for me?", ct))
{
    if (ev.Type == AgentChatEventType.Chunk) Console.Write(ev.Text);
    if (ev.Type == AgentChatEventType.Done) Console.WriteLine($"\n({ev.Model})");
}
```

This calls `POST /api/chat` and reads the server-sent events as they arrive. An error event throws `ThreeWsApiException` with the server's code. For a multi-turn conversation, pass an `AgentMessageRequest` with `History`.

## Authentication

```csharp
var client = new ThreeWsClient(new ThreeWsClientOptions { ApiKey = "sk_live_..." });
```

- **API key.** Create one at [Dashboard → API](https://three.ws/dashboard/api). It starts with `sk_live_`.
- **OAuth token.** Set `AccessToken`, or `AccessTokenProvider` for a token your code refreshes. The provider is called before every request.

The SDK sends the credential as `Authorization: Bearer`, and only to the configured `BaseUrl` origin: a GLB downloaded from another host never receives it. A call that needs credentials and has none throws `ThreeWsAuthenticationException` with `ErrorCode == "unauthorized"`. Keep keys on a server. Never put one in a game build or a mobile app.

## ASP.NET Core and IHttpClientFactory

```csharp
builder.Services.AddHttpClient<ThreeWsClient>((http, sp) =>
    new ThreeWsClient(http, new ThreeWsClientOptions { ApiKey = builder.Configuration["ThreeWs:ApiKey"] }));
```

The SDK never disposes an `HttpClient` you pass in. A client it creates itself has no timeout, so long waits are bounded by your `CancellationToken`. Every method accepts one.

## Retries, idempotency and errors

**Retries.**
- Every request retries 429 and 503 answers with jittered exponential backoff (full jitter, 500 ms base, 30 s cap, 3 retries by default). It waits at least as long as `Retry-After` asks.
- Other 5xx answers and network failures are retried only for GET requests and for requests with an idempotency key.

**Idempotency.** Every create call sends an `Idempotency-Key`, so a retry gets the first job back instead of starting a second GPU run: Forge create, rig, and agent create all do. Set `ForgeRequest.IdempotencyKey` or `CreateAgentRequest.IdempotencyKey` to make your own retries safe too. The server-side rules are in the [API reference](./api-reference.md).

**Errors.** Every failure is a `ThreeWsApiException`, or one of its subclasses:
- `ThreeWsAuthenticationException`
- `ThreeWsRateLimitException`
- `ThreeWsNotFoundException`

Each carries the HTTP status, the API's `ErrorCode`, the server message, the request id and `Retry-After`. A failed Forge job throws `ThreeWsJobFailedException`.

## Unity

The `netstandard2.1` build runs in Unity. The [Unity sample](https://github.com/nirholas/three.ws/tree/main/sdk-dotnet/samples/unity) has three parts:

- `ThreeWsModelSpawner`, a MonoBehaviour. Type a prompt in the Inspector, press Play, and the generated model is loaded with [glTFast](https://github.com/Unity-Technologies/com.unity.cloud.gltfast) (Apache-2.0, Unity Technologies) as a child of the GameObject.
- `export-plugins.sh`, which copies the SDK and its four System DLLs into `Assets/Plugins`.
- A `link.xml` for IL2CPP managed code stripping.

The SDK serializes with source-generated System.Text.Json, so AOT builds need no reflection workarounds. WebGL players cannot use `HttpClient` sockets; call the same endpoints through `UnityWebRequest` there.

## Testing and releases

The SDK's xUnit suite runs against the real production API. It runs on both builds:

```bash
cd sdk-dotnet
dotnet test tests/ThreeWs.Sdk.Tests -c Release
dotnet test tests/ThreeWs.Sdk.Tests -c Release -p:SdkTarget=netstandard2.1
```

It covers:
- generating and downloading a real model on the Studio lane and on a free Forge lane;
- catalog search and paging;
- public agents and streaming chat;
- the MCP tool list;
- the documented `401` shapes for account calls.

Set `THREE_WS_API_KEY` to run the authenticated calls for real. `dotnet pack src/ThreeWs.Sdk -c Release -o artifacts` builds the NuGet package, with symbols. Release notes are in the [CHANGELOG](https://github.com/nirholas/three.ws/blob/main/sdk-dotnet/CHANGELOG.md).

## Related

- [API reference](./api-reference.md): every endpoint the SDK calls.
- [Forge](./forge.md): lanes, tiers and quality gates.
- [MCP studio](./mcp-studio.md): the free MCP server.
- [JavaScript SDK](./sdk.md): the npm packages.
- [Microsoft](./microsoft.md): three.ws and Microsoft have announced a partnership. This page also lists the Microsoft-ecosystem surfaces.
