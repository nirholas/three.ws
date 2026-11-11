using System;
using System.Threading;
using GLTFast;
using ThreeWs.Sdk;
using ThreeWs.Sdk.Forge;
using UnityEngine;

namespace ThreeWs.Samples.Unity
{
    /// <summary>
    /// Generates a 3D model from a prompt with three.ws and spawns it under this GameObject using glTFast.
    /// Add it to an empty GameObject, type a prompt in the Inspector and press Play, or call
    /// <see cref="Generate"/> from your own UI.
    /// </summary>
    public sealed class ThreeWsModelSpawner : MonoBehaviour
    {
        [Tooltip("Describe one object, character or creature.")]
        [SerializeField] private string prompt = "a weathered wooden treasure chest";

        [Tooltip("draft is fastest; standard and high add detail and take longer.")]
        [SerializeField] private string tier = ForgeTiers.Draft;

        [SerializeField] private bool generateOnStart = true;

        [Tooltip("Give up after this many seconds.")]
        [SerializeField] private float timeoutSeconds = 600f;

        private static ThreeWsClient? _client;
        private CancellationTokenSource? _cts;
        private GltfImport? _import;

        /// <summary>The latest status line, for a UI label.</summary>
        public string Status { get; private set; } = "Idle";

        /// <summary>Fires when the model is in the scene.</summary>
        public event Action<GameObject>? Spawned;

        private void Start()
        {
            if (generateOnStart) Generate(prompt);
        }

        /// <summary>Starts a generation, cancelling one in flight.</summary>
        public async void Generate(string text)
        {
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
            var token = _cts.Token;

            // The free lanes need no key. Never ship an API key inside a game build: proxy
            // authenticated calls through your own server instead.
            _client ??= new ThreeWsClient(new ThreeWsClientOptions { UserAgentSuffix = "unity/" + Application.unityVersion });

            try
            {
                var model = await ThreeWsModelRequest.GenerateAsync(_client, text, tier, new Progress<string>(s => Status = s), token);
                token.ThrowIfCancellationRequested();

                Status = "Loading";
                _import?.Dispose();
                _import = new GltfImport();
                if (!await _import.LoadGltfBinary(model.Glb, model.SourceUrl, cancellationToken: token))
                {
                    Status = "glTFast could not read the model";
                    Debug.LogError("[three.ws] glTFast failed to load " + model.SourceUrl);
                    return;
                }

                var root = new GameObject(text);
                root.transform.SetParent(transform, false);
                await _import.InstantiateMainSceneAsync(root.transform, token);
                Status = "Done";
                Debug.Log("[three.ws] Spawned " + model.SourceUrl + " (" + model.Glb.Length + " bytes). Viewer: " + model.ViewerUrl);
                Spawned?.Invoke(root);
            }
            catch (OperationCanceledException)
            {
                Status = "Cancelled";
            }
            catch (ThreeWsApiException ex)
            {
                Status = ex.ErrorCode == "rate_limited" ? "Busy, try again shortly" : "Failed: " + ex.Message;
                Debug.LogWarning("[three.ws] " + (int)ex.StatusCode + " " + ex.ErrorCode + ": " + ex.Message);
            }
        }

        private void OnDestroy()
        {
            _cts?.Cancel();
            _cts?.Dispose();
            _import?.Dispose();
        }
    }
}
