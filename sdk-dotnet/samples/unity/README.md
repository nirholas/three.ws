# three.ws in Unity

`ThreeWsModelSpawner` turns a text prompt into a 3D model at runtime and spawns it in your scene. It generates on the free three.ws Studio lane with the `ThreeWs.Sdk` NuGet package, then loads the GLB with [glTFast](https://github.com/Unity-Technologies/com.unity.cloud.gltfast). glTFast is published by Unity Technologies under the Apache-2.0 license.

No account or API key is needed.

## Requirements

- Unity 2022.3 LTS or Unity 6. glTFast 6.18.0 supports Unity 2022.3 and later. The SDK itself runs on any Unity release with .NET Standard 2.1 (2021.2 or later), so on older editors you can pair it with an older glTFast.
- **Player Settings > Other Settings > Api Compatibility Level: .NET Standard 2.1** (the default since 2021.2). `.NET Framework` also works.
- Internet access in the player. Android needs the `INTERNET` permission, which Unity adds automatically when the code uses networking.

## Setup

1. **glTFast.** Open Package Manager and choose *Add package by name*, then enter `com.unity.cloud.gltfast` version `6.18.0`. You can also merge `Packages/manifest.json` from this folder into your project's manifest.
2. **The SDK DLLs.** Run this from a machine that has the .NET 8 SDK:

   ```bash
   ./export-plugins.sh /path/to/YourUnityProject
   ```

   It builds the `netstandard2.1` SDK and copies these files into `Assets/Plugins/ThreeWs`:
   - `ThreeWs.Sdk.dll`
   - `System.Text.Json.dll`
   - `System.Text.Encodings.Web.dll`
   - `Microsoft.Bcl.AsyncInterfaces.dll`
   - `System.Runtime.CompilerServices.Unsafe.dll`

   If you use NuGetForUnity, install `ThreeWs.Sdk` from it instead. If another package already ships one of those System DLLs, keep a single copy.
3. **The sample scripts.** Copy `Assets/ThreeWs` into your project.
4. Add **ThreeWsModelSpawner** to an empty GameObject, type a prompt in the Inspector, and press Play. The model appears as a child of that GameObject after the "Generating", "Sculpting" and "Loading" states. A draft model usually takes under a minute.

To generate from your own UI, call `spawner.Generate("a red mailbox")`. Read `spawner.Status` for a progress label, and subscribe to `spawner.Spawned` to receive the new GameObject.

## Files

| File | What it is |
| --- | --- |
| `Assets/ThreeWs/ThreeWsModelSpawner.cs` | The MonoBehaviour. It handles cancellation and timeout, loads the model with glTFast, and reports errors in the Inspector and the console. |
| `Assets/ThreeWs/ThreeWsModelRequest.cs` | The engine-free half: it generates and downloads to memory. It has no UnityEngine dependency, so the same code runs in a server or a test. |
| `Assets/ThreeWs/ThreeWs.Samples.asmdef` | An assembly definition that references glTFast and `ThreeWs.Sdk.dll`. |
| `Assets/ThreeWs/link.xml` | IL2CPP stripping rules (see below). |
| `Packages/manifest.json` | The glTFast dependency. |
| `export-plugins.sh` | Builds the SDK and copies its DLLs into a Unity project. |
| `Verify/Verify.csproj` | Compiles the engine-free half against netstandard2.1 without Unity (`dotnet build Verify`). |

## Notes on .NET Standard 2.1

- The package ships two builds: `net8.0` for servers and tools, and `netstandard2.1` for Unity. Unity always picks the netstandard2.1 build.
- `IAsyncEnumerable` streaming (`client.Agents.MessageStreamAsync`) works in Unity. Consume it with `await foreach` from an `async` method.
- The SDK uses `ConfigureAwait(false)` internally. Your own `await` in a MonoBehaviour still resumes on the main thread through Unity's synchronization context, so touching `transform` after an SDK call is safe.
- WebGL builds cannot use `HttpClient` sockets. The SDK targets desktop, mobile and console players. For WebGL, call the same HTTP endpoints through `UnityWebRequest`.

## IL2CPP and managed code stripping

The SDK serializes with System.Text.Json **source generation**. The JSON code is generated at compile time and uses no reflection, so IL2CPP and AOT builds work without extra configuration.

Stripping can still remove members on the *High* setting, so this sample ships a `link.xml` that preserves `ThreeWs.Sdk` and the System.Text.Json metadata services. Keep it anywhere under `Assets/` (Unity picks up every `link.xml`). If you see `MissingMethodException` or empty model fields only in IL2CPP builds, the cause is stripping. Lower *Managed Stripping Level* to *Minimal* to confirm, then extend `link.xml`.

## API keys

Never ship an API key inside a game build, because anyone can extract it. The free Studio lane and the asset catalog need no key. For account features such as your own agents or paid tiers, call three.ws from your own backend with the key and have the game talk to that backend. The `ThreeWsClientOptions.AccessTokenProvider` option can also return a short-lived OAuth token that your backend issued to the signed-in player.
