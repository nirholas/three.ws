# Task: Add Content-Type headers and improve error responses in the Go tool server

## Context

`/workspaces/3D-Agent/chat/server/main.go` has two JSON-returning handlers (`ToolSchema` and `InvokeTool`) that do not set `Content-Type: application/json`. This causes some clients to misparse responses and can break fetch-based JSON parsers.

The `InvokeTool` handler also has an error response inconsistency: sometimes it uses `http.Error()` (plain text) and sometimes `json.NewEncoder(w).Encode(map...)` (JSON), so clients can't reliably detect errors.

Current handler (simplified):
```go
func (tr *ToolHandler) InvokeTool(w http.ResponseWriter, r *http.Request) {
    // ...decode...
    if err := json.NewDecoder(...).Decode(&call); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)  // plain text
        return
    }
    // ...invoke...
    if err != nil {
        json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})  // JSON
        return
    }
    json.NewEncoder(w).Encode(out)
}
```

## What to fix

### 1. Set Content-Type on all JSON responses

Add a helper at the top of `main.go`:
```go
func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(v)
}
```

### 2. Update ToolSchema to use writeJSON

```go
func (tr *ToolHandler) ToolSchema(w http.ResponseWriter, r *http.Request) {
    // ... build encodedGroups ...
    writeJSON(w, http.StatusOK, encodedGroups)
}
```

### 3. Update InvokeTool to use consistent JSON errors

Replace all `http.Error(...)` calls with `writeJSON(w, status, map[string]any{"error": msg})`:

```go
func (tr *ToolHandler) InvokeTool(w http.ResponseWriter, r *http.Request) {
    var call struct { ... }
    if err := json.NewDecoder(io.TeeReader(r.Body, os.Stdout)).Decode(&call); err != nil {
        writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
        return
    }

    for _, group := range tr.Groups {
        out, err := group.Repo.Invoke(nil, call.Name, call.Args)
        if err != nil {
            if strings.HasPrefix(err.Error(), "tool not found") {
                continue
            }
            writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
            return
        }
        writeJSON(w, http.StatusOK, out)
        return
    }

    writeJSON(w, http.StatusNotFound, map[string]any{"error": "tool not found: " + call.Name})
}
```

Note the last case: the original code falls through to a bare `http.Error` if no group handled the tool. Replace that with a proper JSON 404.

### 4. Update ListDirectory and ReadFile handlers similarly

Check `/workspaces/3D-Agent/chat/server/files.go` — if those handlers return JSON, apply the same `writeJSON` helper.

## Files to edit
- `/workspaces/3D-Agent/chat/server/main.go`
- `/workspaces/3D-Agent/chat/server/files.go` (if it returns JSON)

## Verification
- `cd /workspaces/3D-Agent/chat/server && go build .` — must compile
- `curl -i http://localhost:8081/tool_schema` — response headers must include `Content-Type: application/json`
- `curl -i -X POST http://localhost:8081/tool -d 'bad json'` — must return JSON `{"error":"..."}` not plain text, with status 400
- `curl -i -X POST http://localhost:8081/tool -H 'Content-Type: application/json' -d '{"name":"nonexistent","arguments":{}}'` — must return JSON `{"error":"tool not found: nonexistent"}` with status 404
