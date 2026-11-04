package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// A caller on the loopback socket must not be able to rewrite the peer address
// the handlers and request log see by sending forwarding headers
// (GHSA-3fxj-6jh8-hvhx: chi's RealIP trusted the leftmost X-Forwarded-For).
func TestRouterIgnoresSpoofedForwardingHeaders(t *testing.T) {
	r := newRouter(nil, "secret")
	var seen string
	r.Get("/probe", func(w http.ResponseWriter, req *http.Request) { seen = req.RemoteAddr })

	for _, h := range []string{"X-Forwarded-For", "X-Real-IP", "True-Client-IP"} {
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = "127.0.0.1:51234"
		req.Header.Set("Authorization", "Basic secret")
		req.Header.Set(h, "203.0.113.9")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", h, rec.Code)
		}
		if seen != "127.0.0.1:51234" {
			t.Fatalf("%s rewrote RemoteAddr to %q", h, seen)
		}
	}
}
