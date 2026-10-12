## Hands a downloaded Forge GLB to Godot's own GLTFDocument. No glTF parsing
## lives here: this calls the engine's native importer, per
## specs/ENGINE_BRIDGE.md section 6/7, and applies the four shared import
## settings every bridge in this spec exposes under the same names.
extends RefCounted
class_name ThreeWsForgeImporter

## import_settings keys (all optional, defaults shown):
##   generate_colliders: bool = false
##   import_materials:   bool = true
##   scale:              float = 1.0
static func import_glb(glb_path: String, import_settings: Dictionary = {}) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(glb_path, state)
	if err != OK:
		push_error("ThreeWsForgeImporter: failed to read %s (error %d)" % [glb_path, err])
		return null

	var root := doc.generate_scene(state)
	if root == null:
		push_error("ThreeWsForgeImporter: GLTFDocument produced no scene for %s" % glb_path)
		return null

	var scale: float = import_settings.get("scale", 1.0)
	if scale != 1.0 and root is Node3D:
		(root as Node3D).scale = Vector3.ONE * scale

	if not import_settings.get("import_materials", true):
		_strip_materials(root)

	if import_settings.get("generate_colliders", false):
		_add_convex_colliders(root)

	return root

## Writes the imported scene as a tracked .tscn resource under destination
## (a res:// path), the Godot-native equivalent of Unity writing under
## Assets/ or Unreal writing under /Game/.
static func save_as_resource(root: Node, destination: String) -> Error:
	var packed := PackedScene.new()
	var err := packed.pack(root)
	if err != OK:
		return err
	return ResourceSaver.save(packed, destination)

static func _strip_materials(node: Node) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		var flat := StandardMaterial3D.new()
		for i in range(mi.get_surface_override_material_count()):
			mi.set_surface_override_material(i, flat)
	for child in node.get_children():
		_strip_materials(child)

static func _add_convex_colliders(node: Node) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh != null:
			mi.create_convex_collision()
	for child in node.get_children():
		_add_convex_colliders(child)
