package guard

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func ok() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
}

func do(h http.Handler, auth string) int {
	req := httptest.NewRequest("POST", "/tool", nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestAuthRejectsWhenNoPasswordConfigured(t *testing.T) {
	if got := do(Auth("")(ok()), ""); got != 401 {
		t.Fatalf("empty password must fail closed, got %d", got)
	}
}

func TestAuthChecksPassword(t *testing.T) {
	h := Auth("s3cret")(ok())
	if do(h, "") != 401 || do(h, "Basic wrong") != 401 {
		t.Fatal("bad credentials accepted")
	}
	if do(h, "Basic s3cret") != 200 {
		t.Fatal("good credentials rejected")
	}
}

func TestAuthLetsPreflightThrough(t *testing.T) {
	req := httptest.NewRequest("OPTIONS", "/tool", nil)
	rec := httptest.NewRecorder()
	Auth("x")(ok()).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("preflight got %d", rec.Code)
	}
}

func TestConfine(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "a.txt")
	os.WriteFile(inside, []byte("x"), 0600)
	outsideDir := t.TempDir()
	secret := filepath.Join(outsideDir, "secret")
	os.WriteFile(secret, []byte("x"), 0600)
	os.Symlink(secret, filepath.Join(root, "link"))

	if _, err := Confine(root, inside); err != nil {
		t.Fatalf("inside rejected: %v", err)
	}
	for _, p := range []string{secret, "/etc/passwd", filepath.Join(root, "..", "x"), filepath.Join(root, "link")} {
		if _, err := Confine(root, p); err == nil {
			t.Fatalf("%s must be rejected", p)
		}
	}
}

func TestLoopbackAddr(t *testing.T) {
	if LoopbackAddr(8081) != "127.0.0.1:8081" {
		t.Fatal("must bind loopback")
	}
}

func TestOriginAllowed(t *testing.T) {
	l := DefaultOrigins
	for o, want := range map[string]bool{
		"https://three.ws": true, "http://localhost:5174": true, "http://127.0.0.1:3000": true,
		"https://evil.example": false, "https://three.ws.evil.example": false, "": false,
	} {
		if OriginAllowed(l, o) != want {
			t.Fatalf("%q want %v", o, want)
		}
	}
}
