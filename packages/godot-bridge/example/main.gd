## Runnable example for packages/godot-bridge: type a prompt, press Generate,
## watch a real three.ws Forge generation land in the scene.
##
## Run it: `godot --path packages/godot-bridge` (opens the editor on this
## project) then press Play, or headless with
## `godot --headless --path packages/godot-bridge example/main.tscn`.
extends Node3D

@onready var client: ThreeWsClient = $ThreeWsClient
@onready var prompt_edit: LineEdit = $UI/Panel/VBox/PromptEdit
@onready var generate_button: Button = $UI/Panel/VBox/GenerateButton
@onready var status_label: Label = $UI/Panel/VBox/StatusLabel

var _imported_root: Node3D

func _ready() -> void:
	generate_button.pressed.connect(_on_generate_pressed)

func _on_generate_pressed() -> void:
	var prompt := prompt_edit.text.strip_edges()
	if prompt == "":
		status_label.text = "Type a prompt first."
		return
	generate_button.disabled = true
	await _generate(prompt)
	generate_button.disabled = false

func _generate(prompt: String) -> void:
	status_label.text = "Submitting \"%s\"..." % prompt
	var submitted := await client.submit_text(prompt, "draft")
	if not submitted.ok:
		status_label.text = "Submit failed: %s" % submitted.error
		return

	var glb_url: String = submitted.glb_url
	if glb_url == "":
		status_label.text = "Generating on %s..." % submitted.backend
		var finished := await client.wait_for_glb(submitted.job_id)
		if not finished.ok:
			status_label.text = "Generation failed: %s" % finished.error
			return
		glb_url = finished.glb_url

	status_label.text = "Downloading..."
	var dest := OS.get_cache_dir().path_join("three_ws_example.glb")
	var downloaded := await client.download_glb(glb_url, dest)
	if not downloaded.ok:
		status_label.text = "Download failed: %s" % downloaded.error
		return

	if _imported_root:
		_imported_root.queue_free()
	_imported_root = ThreeWsForgeImporter.import_glb(dest, {"generate_colliders": true})
	if _imported_root == null:
		status_label.text = "Import failed."
		return
	add_child(_imported_root)
	status_label.text = "Imported %d bytes from %s." % [downloaded.bytes, dest]
