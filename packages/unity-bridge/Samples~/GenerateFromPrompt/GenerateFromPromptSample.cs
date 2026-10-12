// Runtime sample: generates a mesh from a text prompt and drops it in front
// of the camera when Space is pressed. No editor tooling involved, this is
// the same Runtime API a shipped game would call.
using System.IO;
using ThreeWs.ForgeBridge;
using UnityEngine;

namespace ThreeWs.ForgeBridge.Samples
{
	public class GenerateFromPromptSample : MonoBehaviour
	{
		[TextArea]
		public string Prompt = "a weathered lighthouse";
		public string Tier = "draft";

		private ThreeWsClient _client;
		private bool _busy;

		private void Awake()
		{
			_client = new ThreeWsClient();
		}

		private void Update()
		{
			if (!_busy && Input.GetKeyDown(KeyCode.Space))
			{
				_ = GenerateAsync();
			}
		}

		private async System.Threading.Tasks.Task GenerateAsync()
		{
			_busy = true;
			Debug.Log($"three.ws Forge: submitting \"{Prompt}\" ({Tier})...");

			var submitted = await _client.SubmitTextAsync(Prompt, Tier);
			if (!submitted.Ok)
			{
				Debug.LogError($"three.ws Forge: submit failed: {submitted.Error}");
				_busy = false;
				return;
			}

			var glbUrl = submitted.GlbUrl;
			if (string.IsNullOrEmpty(glbUrl))
			{
				Debug.Log($"three.ws Forge: generating on {submitted.Backend}...");
				var finished = await _client.WaitForGlbAsync(submitted.JobId);
				if (!finished.Ok)
				{
					Debug.LogError($"three.ws Forge: generation failed: {finished.Error}");
					_busy = false;
					return;
				}
				glbUrl = finished.GlbUrl;
			}

			var destination = Path.Combine(Application.temporaryCachePath, "three_ws_sample.glb");
			var downloaded = await _client.DownloadGlbAsync(glbUrl, destination);
			if (!downloaded.Ok)
			{
				Debug.LogError($"three.ws Forge: download failed: {downloaded.Error}");
				_busy = false;
				return;
			}

			var imported = await ThreeWsForgeImporter.ImportGlbAsync(destination);
			if (imported == null)
			{
				Debug.LogError("three.ws Forge: glTFast could not read the downloaded file.");
				_busy = false;
				return;
			}

			var cam = Camera.main;
			if (cam != null)
			{
				imported.transform.position = cam.transform.position + cam.transform.forward * 3f;
			}
			Debug.Log($"three.ws Forge: imported {downloaded.Bytes} bytes as \"{imported.name}\".");
			_busy = false;
		}
	}
}
