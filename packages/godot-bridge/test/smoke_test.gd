## Headless end-to-end smoke test against the LIVE three.ws Forge API.
## No mock server: this is the exact contract in specs/ENGINE_BRIDGE.md
## exercised for real. Run with:
##
##   godot --headless --path packages/godot-bridge --script test/smoke_test.gd
##
## Exits 0 and prints PASS on success, exits 1 and prints FAIL on any
## failure (network, submit, poll timeout, or a GLTFDocument import error).
extends SceneTree

func _initialize() -> void:
	_run()

func _run() -> void:
	var client := ThreeWsClient.new()
	root.add_child(client)
	await process_frame

	print("[smoke] GET /api/forge?catalog=1")
	var cat := await client.catalog()
	if not cat.ok:
		_fail("catalog() returned HTTP %d" % cat.status)
		return
	print("[smoke] catalog OK, backends: %s" % str(cat.body.get("backends", cat.body.keys())))

	print("[smoke] POST /api/forge (draft text prompt)")
	var submitted := await client.submit_text("a small red cube", "draft")
	if not submitted.ok:
		_fail("submit_text() failed: %s" % submitted.error)
		return
	print("[smoke] submitted, job_id=%s backend=%s status=%s" % [submitted.job_id, submitted.backend, submitted.status])

	var glb_url: String = submitted.glb_url
	if glb_url == "":
		var finished := await client.wait_for_glb(submitted.job_id, 600.0)
		if not finished.ok:
			_fail("wait_for_glb() failed: %s" % finished.error)
			return
		glb_url = finished.glb_url
	print("[smoke] generation done, glb_url=%s" % glb_url)

	var dest := OS.get_cache_dir().path_join("three_ws_smoke_test.glb")
	var downloaded := await client.download_glb(glb_url, dest)
	if not downloaded.ok:
		_fail("download_glb() failed: %s" % downloaded.error)
		return
	if downloaded.bytes <= 0:
		_fail("downloaded GLB is empty")
		return
	print("[smoke] downloaded %d bytes to %s" % [downloaded.bytes, dest])

	var imported := ThreeWsForgeImporter.import_glb(dest)
	if imported == null:
		_fail("ThreeWsForgeImporter.import_glb() returned null")
		return
	var mesh_count := _count_mesh_instances(imported)
	print("[smoke] GLTFDocument imported the scene, %d MeshInstance3D node(s)" % mesh_count)
	if mesh_count <= 0:
		_fail("imported scene has no MeshInstance3D nodes")
		return

	print("PASS")
	quit(0)

func _count_mesh_instances(node: Node) -> int:
	var count := 0
	if node is MeshInstance3D:
		count += 1
	for child in node.get_children():
		count += _count_mesh_instances(child)
	return count

func _fail(message: String) -> void:
	printerr("[smoke] FAIL: %s" % message)
	print("FAIL")
	quit(1)
