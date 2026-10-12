// Real HTTP client for the public three.ws Forge pipeline (/api/forge).
// Implements specs/ENGINE_BRIDGE.md: auth-free generation, catalog browse,
// text/image submit, poll-to-completion, and GLB download. No glTF parsing
// lives here: ThreeWsForgeImporter hands the downloaded bytes to glTFast.
//
// Mirrors the contract packages/godot-bridge and packages/unreal-bridge
// implement in their own languages.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace ThreeWs.ForgeBridge
{
	/// <summary>Result of a submit or poll call against POST/GET /api/forge.</summary>
	public class ForgeJobResult
	{
		public bool Ok;
		public string JobId = "";
		public string Status = "";
		public string GlbUrl = "";
		public string Backend = "";
		public string Error = "";
	}

	/// <summary>Result of downloading a finished GLB to a local path.</summary>
	public class ForgeDownloadResult
	{
		public bool Ok;
		public string Path = "";
		public long Bytes;
		public string Error = "";
	}

	public class ThreeWsClient
	{
		public const string BridgeVersion = "0.1.0";
		private const float PollIntervalSeconds = 2.5f;

		public string BaseUrl = "https://three.ws";
		public string ProviderKey = "";
		// 60s, not 30s: a submit can retry across several lanes server-side
		// (free-first routing + failover) before it responds.
		public int RequestTimeoutSeconds = 60;

		private readonly string _clientHandle;

		public ThreeWsClient()
		{
			_clientHandle = Guid.NewGuid().ToString("N");
		}

		private UnityWebRequest BuildRequest(string path, string method, byte[] body, bool hasBody)
		{
			var request = new UnityWebRequest(BaseUrl + path, method);
			request.timeout = RequestTimeoutSeconds;
			request.downloadHandler = new DownloadHandlerBuffer();
			if (hasBody)
			{
				request.uploadHandler = new UploadHandlerRaw(body);
				request.SetRequestHeader("Content-Type", "application/json");
			}
			request.SetRequestHeader("Accept", "application/json");
			request.SetRequestHeader("x-forge-client", _clientHandle);
			request.SetRequestHeader("x-engine-bridge", "unity/" + BridgeVersion);
			request.SetRequestHeader("User-Agent", "three-ws-unity-bridge/" + BridgeVersion);
			if (!string.IsNullOrEmpty(ProviderKey))
			{
				request.SetRequestHeader("x-forge-provider-key", ProviderKey);
			}
			return request;
		}

		private static async Task WaitFor(UnityWebRequestAsyncOperation op)
		{
			while (!op.isDone)
			{
				await Task.Yield();
			}
		}

		private async Task<(bool ok, long status, JObject body, string error)> RequestAsync(
			string path, string method, object jsonBody = null)
		{
			byte[] bodyBytes = null;
			bool hasBody = jsonBody != null;
			if (hasBody)
			{
				bodyBytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(jsonBody));
			}

			using var request = BuildRequest(path, method, bodyBytes, hasBody);
			try
			{
				await WaitFor(request.SendWebRequest());
			}
			catch (Exception ex)
			{
				return (false, 0, new JObject(), $"request failed: {ex.Message}");
			}

			if (request.result == UnityWebRequest.Result.ConnectionError ||
				request.result == UnityWebRequest.Result.DataProcessingError)
			{
				return (false, request.responseCode, new JObject(), request.error);
			}

			var text = request.downloadHandler.text;
			JObject parsed = new JObject();
			if (!string.IsNullOrEmpty(text))
			{
				try
				{
					parsed = JObject.Parse(text);
				}
				catch (JsonException)
				{
					// Non-JSON body (e.g. an upstream gateway HTML error page). Leave parsed empty;
					// callers treat an empty body with a non-2xx status as a generic HTTP failure.
				}
			}

			bool ok = request.responseCode >= 200 && request.responseCode < 300;
			return (ok, request.responseCode, parsed, "");
		}

		/// <summary>GET /api/forge?catalog=1, the live tier/backend/cost matrix.</summary>
		public async Task<JObject> GetCatalogAsync()
		{
			var (ok, status, body, _) = await RequestAsync("/api/forge?catalog=1", UnityWebRequest.kHttpVerbGET);
			if (!ok)
			{
				throw new ForgeException($"catalog request failed with HTTP {status}");
			}
			return body;
		}

		/// <summary>GET /api/forge?health=1, live per-lane up/down status.</summary>
		public async Task<JObject> GetHealthAsync()
		{
			var (ok, status, body, _) = await RequestAsync("/api/forge?health=1", UnityWebRequest.kHttpVerbGET);
			if (!ok)
			{
				throw new ForgeException($"health request failed with HTTP {status}");
			}
			return body;
		}

		/// <summary>POST /api/forge-upload, then PUT the bytes. Returns the public URL.</summary>
		public async Task<string> UploadReferenceImageAsync(byte[] bytes, string contentType)
		{
			string checksum;
			using (var sha256 = SHA256.Create())
			{
				checksum = BitConverter.ToString(sha256.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
			}

			var presignBody = new Dictionary<string, object>
			{
				["content_type"] = contentType,
				["size_bytes"] = bytes.Length,
				["checksum_sha256"] = checksum,
			};
			var (ok, _, presign, _) = await RequestAsync("/api/forge-upload", UnityWebRequest.kHttpVerbPOST, presignBody);
			if (!ok || presign["upload_url"] == null || presign["public_url"] == null)
			{
				var message = presign["message"]?.ToString() ??
					"This deployment has no object storage configured. Pass a public https image URL instead.";
				throw new ForgeException(message);
			}

			using var put = new UnityWebRequest(presign["upload_url"]!.ToString(), UnityWebRequest.kHttpVerbPUT);
			put.uploadHandler = new UploadHandlerRaw(bytes);
			put.downloadHandler = new DownloadHandlerBuffer();
			if (presign["headers"] is JObject headerMap)
			{
				foreach (var pair in headerMap)
				{
					put.SetRequestHeader(pair.Key, pair.Value?.ToString() ?? "");
				}
			}
			else
			{
				put.SetRequestHeader("Content-Type", contentType);
			}
			await WaitFor(put.SendWebRequest());
			if (put.result != UnityWebRequest.Result.Success)
			{
				throw new ForgeException($"uploading the reference image failed with HTTP {put.responseCode}");
			}
			return presign["public_url"]!.ToString();
		}

		/// <summary>POST /api/forge with a text prompt.</summary>
		public async Task<ForgeJobResult> SubmitTextAsync(
			string prompt, string tier = "standard", string path = "image", string backend = null, string aspectRatio = "1:1")
		{
			var body = new Dictionary<string, object>
			{
				["prompt"] = prompt,
				["tier"] = tier,
				["path"] = path,
				["aspect_ratio"] = aspectRatio,
			};
			if (!string.IsNullOrEmpty(backend)) body["backend"] = backend;
			return await SubmitAsync(body);
		}

		/// <summary>POST /api/forge with one or more public https image URLs.</summary>
		public async Task<ForgeJobResult> SubmitImageAsync(
			IEnumerable<string> imageUrls, string prompt = "", string tier = "standard", string path = "image", string backend = null)
		{
			var body = new Dictionary<string, object>
			{
				["image_urls"] = new List<string>(imageUrls),
				["tier"] = tier,
				["path"] = path,
			};
			if (!string.IsNullOrEmpty(prompt)) body["prompt"] = prompt;
			if (!string.IsNullOrEmpty(backend)) body["backend"] = backend;
			return await SubmitAsync(body);
		}

		private async Task<ForgeJobResult> SubmitAsync(Dictionary<string, object> body)
		{
			var (ok, status, data, _) = await RequestAsync("/api/forge", UnityWebRequest.kHttpVerbPOST, body);
			var result = new ForgeJobResult();
			if (!ok)
			{
				result.Error = data["message"]?.ToString() ?? $"submit failed with HTTP {status}";
				return result;
			}
			if (data["error"] != null)
			{
				result.Error = data["message"]?.ToString() ?? data["error"]!.ToString();
				return result;
			}
			result.Ok = true;
			result.JobId = data["job_id"]?.ToString() ?? "";
			result.Status = data["status"]?.ToString() ?? "queued";
			result.GlbUrl = data["glb_url"]?.ToString() ?? "";
			result.Backend = data["backend"]?.ToString() ?? "";
			return result;
		}

		/// <summary>
		/// Poll GET /api/forge?job=&lt;id&gt; until done or failed, or timeoutSeconds elapses.
		/// Keeps polling the SAME job id throughout: poll-time failover is server-side.
		/// </summary>
		public async Task<ForgeJobResult> WaitForGlbAsync(string jobId, float timeoutSeconds = 600f)
		{
			var started = Time.realtimeSinceStartupAsDouble;
			while (true)
			{
				var (ok, status, data, _) = await RequestAsync(
					$"/api/forge?job={UnityWebRequest.EscapeURL(jobId)}", UnityWebRequest.kHttpVerbGET);
				var result = new ForgeJobResult { JobId = jobId };
				if (!ok)
				{
					result.Error = $"poll failed with HTTP {status}";
					return result;
				}
				var jobStatus = data["status"]?.ToString() ?? "running";
				if (jobStatus == "done" && data["glb_url"] != null)
				{
					result.Ok = true;
					result.Status = jobStatus;
					result.GlbUrl = data["glb_url"]!.ToString();
					result.Backend = data["backend"]?.ToString() ?? "";
					return result;
				}
				if (jobStatus == "failed")
				{
					result.Error = data["error"]?.ToString() ?? "Generation failed.";
					return result;
				}
				if (Time.realtimeSinceStartupAsDouble - started > timeoutSeconds)
				{
					result.Error = $"generation {jobId} was still \"{jobStatus}\" after {(int)timeoutSeconds}s";
					return result;
				}
				await Task.Delay(TimeSpan.FromSeconds(PollIntervalSeconds));
			}
		}

		/// <summary>Stream a generated GLB to a local absolute path.</summary>
		public async Task<ForgeDownloadResult> DownloadGlbAsync(string url, string destinationPath)
		{
			using var request = UnityWebRequest.Get(url);
			request.SetRequestHeader("User-Agent", "three-ws-unity-bridge/" + BridgeVersion);
			request.downloadHandler = new DownloadHandlerFile(destinationPath) { removeFileOnAbort = true };
			await WaitFor(request.SendWebRequest());
			var result = new ForgeDownloadResult { Path = destinationPath };
			if (request.result != UnityWebRequest.Result.Success)
			{
				result.Error = $"downloading the GLB failed with HTTP {request.responseCode}";
				return result;
			}
			result.Ok = true;
			result.Bytes = (long)request.downloadedBytes;
			return result;
		}
	}

	public class ForgeException : Exception
	{
		public ForgeException(string message) : base(message) { }
	}
}
