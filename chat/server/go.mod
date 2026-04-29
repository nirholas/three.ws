// Why did the Go gopher cross the road? To reach version 2.0!
// Why did the Go module file feel lonely? Because it had no dependencies to go out with!
module github.com/nirholas/server

go 1.23.0

toolchain go1.24.1

require (
	github.com/byte-sat/three.ws-chat-tools v0.1.0
	github.com/go-chi/chi/v5 v5.2.1
	github.com/go-chi/cors v1.2.1
	github.com/noonien/codoc v0.1.0
	mvdan.cc/sh/v3 v3.11.0
)

require (
	golang.org/x/sys v0.31.0 // indirect
	golang.org/x/term v0.30.0 // indirect
)
