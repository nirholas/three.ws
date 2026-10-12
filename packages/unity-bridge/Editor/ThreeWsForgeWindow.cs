// Editor window: a prompt field, a tier dropdown, and a Generate button
// that runs a real text-to-3D generation and imports the result into the
// open scene using glTFast.
using System.IO;
using ThreeWs.ForgeBridge;
using UnityEditor;
using UnityEngine;

namespace ThreeWs.ForgeBridge.Editor
{
	public class ThreeWsForgeWindow : EditorWindow
	{
		private string _prompt = "a weathered lighthouse";
		private int _tierIndex = 1;
		private static readonly string[] Tiers = { "draft", "standard", "high" };
		private string _status = "Idle.";
		private bool _busy;

		[MenuItem("Window/three.ws/Forge Bridge")]
		public static void Open()
		{
			GetWindow<ThreeWsForgeWindow>("three.ws Forge");
		}

		private void OnGUI()
		{
			EditorGUILayout.LabelField("three.ws Forge", EditorStyles.boldLabel);
			EditorGUILayout.Space();

			_prompt = EditorGUILayout.TextField("Prompt", _prompt);
			_tierIndex = EditorGUILayout.Popup("Tier", _tierIndex, Tiers);

			EditorGUILayout.Space();
			using (new EditorGUI.DisabledScope(_busy || string.IsNullOrWhiteSpace(_prompt)))
			{
				if (GUILayout.Button("Generate and import"))
				{
					_ = RunGenerationAsync();
				}
			}

			EditorGUILayout.Space();
			EditorGUILayout.LabelField("Status", _status);
		}

		private async System.Threading.Tasks.Task RunGenerationAsync()
		{
			_busy = true;
			_status = "Submitting...";
			Repaint();

			var client = new ThreeWsClient();
			try
			{
				var submitted = await client.SubmitTextAsync(_prompt, Tiers[_tierIndex]);
				if (!submitted.Ok)
				{
					_status = $"Submit failed: {submitted.Error}";
					return;
				}

				var glbUrl = submitted.GlbUrl;
				if (string.IsNullOrEmpty(glbUrl))
				{
					_status = $"Generating ({submitted.Backend})...";
					Repaint();
					var finished = await client.WaitForGlbAsync(submitted.JobId);
					if (!finished.Ok)
					{
						_status = $"Generation failed: {finished.Error}";
						return;
					}
					glbUrl = finished.GlbUrl;
				}

				_status = "Downloading...";
				Repaint();
				var destination = Path.Combine(Application.temporaryCachePath, "three_ws_forge_tmp.glb");
				var downloaded = await client.DownloadGlbAsync(glbUrl, destination);
				if (!downloaded.Ok)
				{
					_status = $"Download failed: {downloaded.Error}";
					return;
				}

				_status = "Importing...";
				Repaint();
				var imported = await ThreeWsForgeImporter.ImportGlbAsync(destination);
				if (imported == null)
				{
					_status = "Import failed: glTFast could not read the downloaded file.";
					return;
				}

				Undo.RegisterCreatedObjectUndo(imported, "Generate from three.ws Forge");
				Selection.activeGameObject = imported;
				_status = $"Imported {downloaded.Bytes} bytes.";
			}
			finally
			{
				_busy = false;
				Repaint();
			}
		}
	}
}
