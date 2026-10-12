## Real HTTP client for the public three.ws Forge pipeline (/api/forge).
##
## Implements specs/ENGINE_BRIDGE.md: auth-free generation, catalog browse,
## text/image submit, poll-to-completion, and GLB download. Add one
## ThreeWsClient as a child of a node that stays in the scene tree for as
## long as a request may be in flight (the editor dock, an autoload, or the
## example scene's root all work); it parents a temporary HTTPRequest per
## call and frees it when the call resolves.
##
## Mirrors the same contract packages/unity-bridge and packages/unreal-bridge
## implement in their own languages. No glTF parsing happens here: the
## caller hands the downloaded .glb to Godot's own GLTFDocument.
extends Node
class_name ThreeWsClient

const DEFAULT_BASE_URL := "https://three.ws"
const POLL_INTERVAL_SEC := 2.5
const BRIDGE_VERSION := "0.1.0"

var base_url: String = DEFAULT_BASE_URL
var provider_key: String = ""
## 60s, not 30s: a submit can retry across several lanes server-side
## (free-first routing + failover) before it responds.
var request_timeout_sec: float = 60.0

var _client_handle: String = ""

func _ready() -> void:
	if _client_handle == "":
		_client_handle = _make_client_handle()

func _make_client_handle() -> String:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	var out := ""
	var hex := "0123456789abcdef"
	for i in range(32):
		out += hex[rng.randi_range(0, 15)]
	return out

func _headers(extra_content_type: bool) -> PackedStringArray:
	var headers: Array[String] = [
		"Accept: application/json",
		"x-forge-client: %s" % _client_handle,
		"x-engine-bridge: godot/%s" % BRIDGE_VERSION,
		"User-Agent: three-ws-godot-bridge/%s" % BRIDGE_VERSION,
	]
	if provider_key != "":
		headers.append("x-forge-provider-key: %s" % provider_key)
	if extra_content_type:
		headers.append("Content-Type: application/json")
	return PackedStringArray(headers)

## Fire one HTTP request and await its result. Returns a Dictionary with
## keys: ok (bool), status (int), body (Dictionary, parsed JSON or {} ),
## error (String, only set when the request itself failed to complete).
func _request(path: String, method: HTTPClient.Method, body: Variant = null) -> Dictionary:
	var req := HTTPRequest.new()
	req.timeout = request_timeout_sec
	add_child(req)

	var url := base_url + path
	var body_str := ""
	var has_body := body != null
	if has_body:
		body_str = JSON.stringify(body)

	var err := req.request(url, _headers(has_body), method, body_str)
	if err != OK:
		req.queue_free()
		return {"ok": false, "status": 0, "body": {}, "error": "request() failed with Godot error %d" % err}

	var result: Array = await req.request_completed
	req.queue_free()

	var http_result: int = result[0]
	var response_code: int = result[1]
	var raw_body: PackedByteArray = result[3]

	if http_result != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": response_code, "body": {}, "error": "transport error %d" % http_result}

	var text := raw_body.get_string_from_utf8()
	var parsed: Variant = {}
	if text != "":
		var json := JSON.new()
		if json.parse(text) == OK:
			parsed = json.data
	var ok := response_code >= 200 and response_code < 300
	return {"ok": ok, "status": response_code, "body": parsed, "error": ""}

## GET /api/forge?catalog=1 -> the live tier/backend/cost matrix.
func catalog() -> Dictionary:
	return await _request("/api/forge?catalog=1", HTTPClient.METHOD_GET)

## GET /api/forge?health=1 -> live per-lane up/down status.
func health() -> Dictionary:
	return await _request("/api/forge?health=1", HTTPClient.METHOD_GET)

## POST /api/forge-upload -> presign a local reference image, then PUT it.
## Returns {ok, public_url, error}.
func upload_reference_image(bytes: PackedByteArray, content_type: String) -> Dictionary:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	var checksum := ctx.finish().hex_encode()

	var presign := await _request("/api/forge-upload", HTTPClient.METHOD_POST, {
		"content_type": content_type,
		"size_bytes": bytes.size(),
		"checksum_sha256": checksum,
	})
	if not presign.ok or not presign.body.has("upload_url") or not presign.body.has("public_url"):
		var message: String = presign.body.get("message", "This deployment has no object storage configured. Pass a public https image URL instead.")
		return {"ok": false, "public_url": "", "error": message}

	var put := HTTPRequest.new()
	put.timeout = request_timeout_sec
	add_child(put)
	var put_headers: PackedStringArray = PackedStringArray(["Content-Type: %s" % content_type])
	if presign.body.has("headers"):
		put_headers = PackedStringArray()
		for key in presign.body["headers"].keys():
			put_headers.append("%s: %s" % [key, presign.body["headers"][key]])
	var err := put.request_raw(presign.body["upload_url"], put_headers, HTTPClient.METHOD_PUT, bytes)
	if err != OK:
		put.queue_free()
		return {"ok": false, "public_url": "", "error": "upload request() failed with Godot error %d" % err}
	var result: Array = await put.request_completed
	put.queue_free()
	var response_code: int = result[1]
	if response_code < 200 or response_code >= 300:
		return {"ok": false, "public_url": "", "error": "uploading the reference image failed with HTTP %d" % response_code}
	return {"ok": true, "public_url": presign.body["public_url"], "error": ""}

## POST /api/forge with a text prompt. Returns the submit response body
## (job_id + status, or status: "done" + glb_url for a synchronous lane).
func submit_text(prompt: String, tier: String = "standard", path: String = "image", backend: String = "", aspect_ratio: String = "1:1") -> Dictionary:
	var body := {"prompt": prompt, "tier": tier, "path": path, "aspect_ratio": aspect_ratio}
	if backend != "":
		body["backend"] = backend
	return await _submit(body)

## POST /api/forge with one or more public https image URLs.
func submit_image(image_urls: PackedStringArray, prompt: String = "", tier: String = "standard", path: String = "image", backend: String = "") -> Dictionary:
	var body := {"image_urls": Array(image_urls), "tier": tier, "path": path}
	if prompt != "":
		body["prompt"] = prompt
	if backend != "":
		body["backend"] = backend
	return await _submit(body)

func _submit(body: Dictionary) -> Dictionary:
	var result := await _request("/api/forge", HTTPClient.METHOD_POST, body)
	if not result.ok:
		return {"ok": false, "job_id": "", "status": "failed", "glb_url": "", "error": "submit failed with HTTP %d" % result.status}
	var data: Dictionary = result.body
	if data.has("error"):
		return {"ok": false, "job_id": "", "status": "failed", "glb_url": "", "error": data.get("message", data["error"])}
	return {
		"ok": true,
		"job_id": data.get("job_id", ""),
		"status": data.get("status", "queued"),
		"glb_url": data.get("glb_url", ""),
		"backend": data.get("backend", ""),
		"error": "",
	}

## Poll GET /api/forge?job=<id> until done or failed, or timeout_sec elapses.
## Emits no signal: the caller awaits this coroutine directly.
func wait_for_glb(job_id: String, timeout_sec: float = 600.0) -> Dictionary:
	var started := Time.get_ticks_msec()
	while true:
		var result := await _request("/api/forge?job=%s" % job_id.uri_encode(), HTTPClient.METHOD_GET)
		if not result.ok:
			return {"ok": false, "glb_url": "", "backend": "", "error": "poll failed with HTTP %d" % result.status}
		var data: Dictionary = result.body
		var status: String = data.get("status", "running")
		if status == "done" and data.has("glb_url"):
			return {"ok": true, "glb_url": data["glb_url"], "backend": data.get("backend", ""), "error": ""}
		if status == "failed":
			return {"ok": false, "glb_url": "", "backend": "", "error": data.get("error", "Generation failed.")}
		var elapsed_sec := float(Time.get_ticks_msec() - started) / 1000.0
		if elapsed_sec > timeout_sec:
			return {"ok": false, "glb_url": "", "backend": "", "error": "generation %s was still \"%s\" after %ds" % [job_id, status, int(elapsed_sec)]}
		await get_tree().create_timer(POLL_INTERVAL_SEC).timeout
	return {"ok": false, "glb_url": "", "backend": "", "error": "unreachable"}

## Download a finished GLB to an absolute filesystem path. Returns
## {ok, path, bytes, error}.
func download_glb(url: String, destination_path: String) -> Dictionary:
	var req := HTTPRequest.new()
	req.timeout = request_timeout_sec
	req.download_file = destination_path
	add_child(req)
	var err := req.request(url, PackedStringArray(["User-Agent: three-ws-godot-bridge/%s" % BRIDGE_VERSION]), HTTPClient.METHOD_GET)
	if err != OK:
		req.queue_free()
		return {"ok": false, "path": "", "bytes": 0, "error": "download request() failed with Godot error %d" % err}
	var result: Array = await req.request_completed
	var response_code: int = result[1]
	req.queue_free()
	if response_code < 200 or response_code >= 300:
		return {"ok": false, "path": "", "bytes": 0, "error": "downloading the GLB failed with HTTP %d" % response_code}
	var file := FileAccess.open(destination_path, FileAccess.READ)
	var bytes := 0
	if file:
		bytes = file.get_length()
		file.close()
	return {"ok": true, "path": destination_path, "bytes": bytes, "error": ""}
