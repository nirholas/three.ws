## Editor dock for the three.ws Forge bridge: a prompt box, a Generate
## button, and a status label. Builds the UI in code (no .tscn) so the
## whole addon is plain-text GDScript.
@tool
extends EditorPlugin

var _client: ThreeWsClient
var _dock: Control
var _prompt_edit: LineEdit
var _status_label: Label
var _generate_button: Button

func _enter_tree() -> void:
	_client = ThreeWsClient.new()
	_client.name = "ThreeWsClient"
	add_child(_client)

	_dock = _build_dock()
	add_control_to_dock(EditorPlugin.DOCK_SLOT_RIGHT_UL, _dock)

func _exit_tree() -> void:
	if _dock:
		remove_control_from_docks(_dock)
		_dock.queue_free()
	if _client:
		_client.queue_free()

func _build_dock() -> Control:
	var panel := VBoxContainer.new()
	panel.name = "three.ws Forge"

	var title := Label.new()
	title.text = "three.ws Forge"
	panel.add_child(title)

	_prompt_edit = LineEdit.new()
	_prompt_edit.placeholder_text = "a weathered lighthouse"
	panel.add_child(_prompt_edit)

	_generate_button = Button.new()
	_generate_button.text = "Generate and import"
	_generate_button.pressed.connect(_on_generate_pressed)
	panel.add_child(_generate_button)

	_status_label = Label.new()
	_status_label.text = "Idle."
	_status_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	panel.add_child(_status_label)

	return panel

func _on_generate_pressed() -> void:
	var prompt := _prompt_edit.text.strip_edges()
	if prompt == "":
		_status_label.text = "Type a prompt first."
		return
	_generate_button.disabled = true
	await _run_generation(prompt)
	_generate_button.disabled = false

func _run_generation(prompt: String) -> void:
	_status_label.text = "Submitting..."
	var submitted := await _client.submit_text(prompt)
	if not submitted.ok:
		_status_label.text = "Submit failed: %s" % submitted.error
		return

	var glb_url: String = submitted.glb_url
	if glb_url == "":
		_status_label.text = "Generating (%s)..." % submitted.get("backend", "")
		var finished := await _client.wait_for_glb(submitted.job_id)
		if not finished.ok:
			_status_label.text = "Generation failed: %s" % finished.error
			return
		glb_url = finished.glb_url

	_status_label.text = "Downloading..."
	var dest := "user://three_ws_forge_tmp.glb"
	var downloaded := await _client.download_glb(glb_url, dest)
	if not downloaded.ok:
		_status_label.text = "Download failed: %s" % downloaded.error
		return

	var root := ThreeWsForgeImporter.import_glb(ProjectSettings.globalize_path(dest))
	if root == null:
		_status_label.text = "Import failed: GLTFDocument could not read the downloaded file."
		return

	var edited_scene := EditorInterface.get_edited_scene_root()
	if edited_scene:
		edited_scene.add_child(root)
		root.owner = edited_scene

	_status_label.text = "Imported (%d bytes)." % downloaded.bytes
