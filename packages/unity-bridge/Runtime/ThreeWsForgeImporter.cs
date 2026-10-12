// Hands a downloaded Forge GLB to glTFast, Unity's glTF importer. No glTF
// parsing lives here, per specs/ENGINE_BRIDGE.md section 6/7. Applies the
// four shared import settings every bridge in this spec exposes under the
// same names.
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace ThreeWs.ForgeBridge
{
	public struct ForgeImportSettings
	{
		public bool GenerateColliders;
		public bool ImportMaterials;
		public float Scale;

		public static ForgeImportSettings Default => new ForgeImportSettings
		{
			GenerateColliders = false,
			ImportMaterials = true,
			Scale = 1f,
		};
	}

	public static class ThreeWsForgeImporter
	{
		/// <summary>
		/// Loads a local .glb file with glTFast and instantiates it as a child
		/// of the given parent (pass null to create a free-standing root).
		/// Returns null and logs an error if glTFast could not load the file.
		/// </summary>
		public static async Task<GameObject> ImportGlbAsync(
			string glbPath, Transform parent = null, ForgeImportSettings? settings = null)
		{
			var resolved = settings ?? ForgeImportSettings.Default;

			var gltf = new GltfImport();
			var loadOk = await gltf.Load(glbPath);
			if (!loadOk)
			{
				Debug.LogError($"ThreeWsForgeImporter: glTFast could not load {glbPath}");
				return null;
			}

			var root = new GameObject(System.IO.Path.GetFileNameWithoutExtension(glbPath));
			if (parent != null)
			{
				root.transform.SetParent(parent, false);
			}

			var instantiateOk = await gltf.InstantiateMainSceneAsync(root.transform);
			if (!instantiateOk)
			{
				Debug.LogError($"ThreeWsForgeImporter: glTFast could not instantiate the scene from {glbPath}");
				Object.Destroy(root);
				return null;
			}

			if (resolved.Scale != 1f)
			{
				root.transform.localScale = Vector3.one * resolved.Scale;
			}
			if (!resolved.ImportMaterials)
			{
				StripMaterials(root);
			}
			if (resolved.GenerateColliders)
			{
				AddConvexColliders(root);
			}

			return root;
		}

		private static void StripMaterials(GameObject root)
		{
			var flat = new Material(Shader.Find("Standard"));
			foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>())
			{
				var materials = renderer.sharedMaterials;
				for (var i = 0; i < materials.Length; i++)
				{
					materials[i] = flat;
				}
				renderer.sharedMaterials = materials;
			}
		}

		private static void AddConvexColliders(GameObject root)
		{
			foreach (var filter in root.GetComponentsInChildren<MeshFilter>())
			{
				if (filter.sharedMesh == null) continue;
				var collider = filter.gameObject.AddComponent<MeshCollider>();
				collider.sharedMesh = filter.sharedMesh;
				collider.convex = true;
			}
		}
	}
}
