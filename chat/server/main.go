package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/byte-sat/three.ws-chat-tools/schema"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/nirholas/server/toolfns"
)

var (
	password  = flag.String("password", "", "Password for basic auth.")
	filesPath = flag.String("files", ".", "Path to the directory we're working with")
)

func main() {
	flag.Parse()

	r := chi.NewRouter()
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	}))
	r.Use(authMiddleware)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	th := &ToolHandler{Groups: toolfns.ToolGroups}
	r.Get("/tool_schema", th.ToolSchema)
	r.Post("/tool", th.InvokeTool)

	r.Get("/list_directory", ListDirectory)
	r.Get("/read_file", ReadFile)

	fmt.Println("Tool server running at http://localhost:8081")
	httpServer := &http.Server{Addr: ":8081", Handler: r}
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// Signal handling
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	<-c // Block until a signal is received.

	// Graceful shutdown
	if err := httpServer.Shutdown(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *password != "" && r.Header.Get("Authorization") != ("Basic "+*password) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type ToolHandler struct {
	Groups []*toolfns.Group
}

func (tr *ToolHandler) ToolSchema(w http.ResponseWriter, r *http.Request) {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")

	type encodedGroup struct {
		Name   string            `json:"name"`
		Schema []schema.Function `json:"schema"`
	}

	var encodedGroups []encodedGroup
	for _, group := range tr.Groups {
		encodedGroups = append(encodedGroups, encodedGroup{
			Name:   group.Name,
			Schema: group.Repo.Schema(),
		})
	}
	err := enc.Encode(encodedGroups)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (tr *ToolHandler) InvokeTool(w http.ResponseWriter, r *http.Request) {
	var call struct {
		ChatID string         `json:"chat_id"`
		Name   string         `json:"name"`
		Args   map[string]any `json:"arguments"`
	}
	if err := json.NewDecoder(io.TeeReader(r.Body, os.Stdout)).Decode(&call); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var err error
	for _, group := range tr.Groups {
		var out any
		out, err = group.Repo.Invoke(nil, call.Name, call.Args)
		if err != nil {
			if strings.HasPrefix(err.Error(), "tool not found") {
				continue
			}
			json.NewEncoder(w).Encode(map[string]any{
				"error": err.Error(),
			})
			return
		}
		json.NewEncoder(w).Encode(out)
		return
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
	}
}
