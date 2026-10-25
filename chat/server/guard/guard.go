// Package guard holds the access controls for the local tool server: loopback
// binding, fail-closed password auth, CORS origin matching, and path
// confinement. It depends only on the standard library.
package guard

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
)

// DefaultOrigins are the web origins allowed to call the server from a browser.
var DefaultOrigins = []string{"https://three.ws", "https://www.three.ws"}

// LoopbackAddr returns the listen address bound to the loopback interface only.
func LoopbackAddr(port int) string { return fmt.Sprintf("127.0.0.1:%d", port) }

// NewToken returns a random 128-bit hex token for use as a generated password.
func NewToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// OriginAllowed reports whether a browser Origin may call the server: an exact
// match in allowed, or any http(s) localhost / 127.0.0.1 origin.
func OriginAllowed(allowed []string, origin string) bool {
	if origin == "" {
		return false
	}
	for _, a := range allowed {
		if origin == a {
			return true
		}
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// Auth requires "Authorization: Basic <password>" on every request except CORS
// preflight. An empty configured password rejects everything (fail closed).
func Auth(password string) func(http.Handler) http.Handler {
	want := []byte("Basic " + password)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			got := []byte(r.Header.Get("Authorization"))
			if password == "" || subtle.ConstantTimeCompare(got, want) != 1 {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Confine resolves path (following symlinks) and returns it only if it lies
// inside root.
func Confine(root, path string) (string, error) {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	realRoot, err = filepath.Abs(realRoot)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(realRoot, real)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path is outside the served directory")
	}
	return real, nil
}
