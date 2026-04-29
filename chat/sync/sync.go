package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
)

// Conversation represents a chat conversation containing multiple messages
type Conversation map[string]any

// Message represents a single message in a conversation
type Message map[string]any

// UserData contains all conversations and messages for a specific user
type UserData struct {
	Conversations map[string]Conversation `json:"conversations"`
	Messages      map[string]Message      `json:"messages"`
	APIKeys       map[string]string       `json:"apiKeys"`
}

// In-memory storage with mutex for concurrency protection
var (
	storage = make(map[string]UserData) // Map from user token to their data
	mutex   = &sync.RWMutex{}           // Lock for concurrent access to storage
)

// Request and response types
type CheckClientMissingRequest struct {
	Token           string   `json:"token"`
	ConversationIds []string `json:"conversationIds"`
	MessageIds      []string `json:"messageIds"`
}

type CheckClientMissingResponse struct {
	MissingConversationIds []string `json:"missingConversationIds"`
	MissingMessageIds      []string `json:"missingMessageIds"`
}

type GetItemsRequest struct {
	Token           string   `json:"token"`
	ConversationIds []string `json:"conversationIds"`
	MessageIds      []string `json:"messageIds"`
}

type GetItemsResponse struct {
	Conversations map[string]Conversation `json:"conversations"`
	Messages      map[string]Message      `json:"messages"`
	APIKeys       map[string]string       `json:"apiKeys"`
}

type CheckServerMissingRequest struct {
	Token           string   `json:"token"`
	ConversationIds []string `json:"conversationIds"`
	MessageIds      []string `json:"messageIds"`
}

type CheckServerMissingResponse struct {
	MissingConversationIds []string `json:"missingConversationIds"`
	MissingMessageIds      []string `json:"missingMessageIds"`
}

type SendItemsRequest struct {
	Token         string                  `json:"token"`
	Conversations map[string]Conversation `json:"conversations"`
	Messages      map[string]Message      `json:"messages"`
}

type SendItemsResponse struct {
	Success bool `json:"success"`
}

type SendSingleItemRequest struct {
	Token        string            `json:"token"`
	Conversation *Conversation     `json:"conversation,omitempty"`
	Message      *Message          `json:"message,omitempty"`
	APIKeys      map[string]string `json:"apiKeys,omitempty"`
}

type SendSingleItemResponse struct {
	Success bool `json:"success"`
}

// Request and response types for deleting single items
type DeleteSingleItemRequest struct {
	Token          string `json:"token"`
	ConversationId string `json:"conversationId,omitempty"`
	MessageId      string `json:"messageId,omitempty"`
}

type DeleteSingleItemResponse struct {
	Success bool `json:"success"`
}

func main() {
	// Load storage from file if exists
	loadStorageFromFile()

	// Save storage to file periodically
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			saveStorageToFile()
		}
	}()

	// Create a new Chi router
	r := chi.NewRouter()

	// Add middleware
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	}))
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Add a simple health check endpoint
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// API routes
	r.Route("/api/sync", func(r chi.Router) {
		// Rate limited endpoints (60 requests per minute with burst of 5)
		r.With(httprate.LimitByIP(60, 1*time.Minute)).Group(func(r chi.Router) {
			r.Post("/check-client-missing", handleCheckClientMissing)
			r.Post("/get-items", handleGetItems)
			r.Post("/check-server-missing", handleCheckServerMissing)
		})
		// Not rate limited endpoints
		r.Post("/send-items", handleSendItems)
		r.Post("/send-single-item", handleSendSingleItem)
		r.Post("/delete-single-item", handleDeleteSingleItem)
	})

	// Start server
	port := getEnv("PORT", "8084")
	log.Printf("Server starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

// handleCheckClientMissing finds what items the client is missing compared to the server
func handleCheckClientMissing(w http.ResponseWriter, r *http.Request) {
	var req CheckClientMissingRequest
	if err := parseBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	// Get user data or create new if not exists
	mutex.RLock()
	userData, exists := storage[req.Token]
	mutex.RUnlock()

	if !exists {
		// No data for this token
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(CheckClientMissingResponse{
			MissingConversationIds: []string{},
			MissingMessageIds:      []string{},
		})
		return
	}

	// Find missing conversations, including Modified ones and tombstones
	missingConversations := []string{}
	for convId, conv := range userData.Conversations {
		// Always include tombstones so clients know about deletions
		if deleted, ok := conv["deleted"].(bool); ok && deleted {
			missingConversations = append(missingConversations, convId)
			continue
		}

		// Always include Modified conversations
		if modified, ok := conv["modified"].(bool); ok && modified {
			missingConversations = append(missingConversations, convId)
			continue
		}

		// Otherwise, include if client doesn't have it
		found := false
		for _, clientConvId := range req.ConversationIds {
			if convId == clientConvId {
				found = true
				break
			}
		}
		if !found {
			missingConversations = append(missingConversations, convId)
		}
	}

	// Find missing messages, including Modified ones and tombstones
	missingMessages := []string{}
	for msgId, msg := range userData.Messages {
		// Always include tombstones so clients know about deletions
		if deleted, ok := msg["deleted"].(bool); ok && deleted {
			missingMessages = append(missingMessages, msgId)
			continue
		}

		// Always include Modified messages
		if modified, ok := msg["modified"].(bool); ok && modified {
			missingMessages = append(missingMessages, msgId)
			continue
		}

		// Otherwise, include if client doesn't have it
		found := false
		for _, clientMsgId := range req.MessageIds {
			if msgId == clientMsgId {
				found = true
				break
			}
		}
		if !found {
			missingMessages = append(missingMessages, msgId)
		}
	}

	resp := CheckClientMissingResponse{
		MissingConversationIds: missingConversations,
		MissingMessageIds:      missingMessages,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// handleGetItems returns the requested conversations and messages
func handleGetItems(w http.ResponseWriter, r *http.Request) {
	var req GetItemsRequest
	if err := parseBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	mutex.Lock() // Using a full lock to safely read and update
	defer mutex.Unlock()

	userData, exists := storage[req.Token]
	if !exists {
		// Return empty data if user not found
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(GetItemsResponse{
			Conversations: make(map[string]Conversation),
			Messages:      make(map[string]Message),
			APIKeys:       make(map[string]string),
		})
		return
	}

	// Collect requested conversations
	conversations := make(map[string]Conversation)
	for _, convId := range req.ConversationIds {
		if conv, ok := userData.Conversations[convId]; ok {
			// For tombstones, only include minimal information
			if deleted, ok := conv["deleted"].(bool); ok && deleted {
				conversations[convId] = Conversation{
					"id":        convId,
					"deleted":   true,
					"deletedAt": conv["deletedAt"],
				}
				continue
			}

			// For regular items, create a clean copy without the Modified flag
			cleanConv := make(Conversation)
			for k, v := range conv {
				if k != "modified" {
					cleanConv[k] = v
				}
			}
			conversations[convId] = cleanConv
		}
	}

	// Collect requested messages
	messages := make(map[string]Message)
	for _, msgId := range req.MessageIds {
		if msg, ok := userData.Messages[msgId]; ok {
			// For tombstones, only include minimal information
			if deleted, ok := msg["deleted"].(bool); ok && deleted {
				messages[msgId] = Message{
					"id":        msgId,
					"deleted":   true,
					"deletedAt": msg["deletedAt"],
				}
				continue
			}

			// For regular items, create a clean copy without the Modified flag
			cleanMsg := make(Message)
			for k, v := range msg {
				if k != "modified" {
					cleanMsg[k] = v
				}
			}
			messages[msgId] = cleanMsg
		}
	}

	// Update storage with reset Modified flags
	storage[req.Token] = userData

	resp := GetItemsResponse{
		Conversations: conversations,
		Messages:      messages,
		APIKeys:       userData.APIKeys, // Include API keys in response
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// handleCheckServerMissing finds what items the server is missing compared to the client
func handleCheckServerMissing(w http.ResponseWriter, r *http.Request) {
	var req CheckServerMissingRequest
	if err := parseBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	mutex.RLock()
	userData, exists := storage[req.Token]
	mutex.RUnlock()

	if !exists {
		// All client items are missing from server
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(CheckServerMissingResponse{
			MissingConversationIds: req.ConversationIds,
			MissingMessageIds:      req.MessageIds,
		})
		return
	}

	// Find which conversations the server is missing
	missingConversations := []string{}
	for _, clientConvId := range req.ConversationIds {
		if _, ok := userData.Conversations[clientConvId]; !ok {
			missingConversations = append(missingConversations, clientConvId)
		}
	}

	// Find which messages the server is missing
	missingMessages := []string{}
	for _, clientMsgId := range req.MessageIds {
		if _, ok := userData.Messages[clientMsgId]; !ok {
			missingMessages = append(missingMessages, clientMsgId)
		}
	}

	resp := CheckServerMissingResponse{
		MissingConversationIds: missingConversations,
		MissingMessageIds:      missingMessages,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// handleSendItems receives multiple items from the client and stores them
func handleSendItems(w http.ResponseWriter, r *http.Request) {
	var req SendItemsRequest
	if err := parseBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	// Get or create user data
	userData, exists := storage[req.Token]
	if !exists {
		userData = UserData{
			Conversations: make(map[string]Conversation),
			Messages:      make(map[string]Message),
			APIKeys:       make(map[string]string),
		}
	}

	// Add conversations, but respect tombstones
	for id, conv := range req.Conversations {
		// Check if there's a tombstone for this id
		if existingConv, exists := userData.Conversations[id]; exists {
			if deleted, ok := existingConv["deleted"].(bool); ok && deleted {
				// This is a tombstone, don't resurrect the item
				continue
			}
		}
		userData.Conversations[id] = conv
	}

	// Add messages, but respect tombstones
	for id, msg := range req.Messages {
		// Check if there's a tombstone for this id
		if existingMsg, exists := userData.Messages[id]; exists {
			if deleted, ok := existingMsg["deleted"].(bool); ok && deleted {
				// This is a tombstone, don't resurrect the item
				continue
			}
		}
		userData.Messages[id] = msg
	}

	// Update storage
	storage[req.Token] = userData

	// Save to file after updates
	go saveStorageToFile()

	resp := SendItemsResponse{
		Success: true,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// handleSendSingleItem receives a single item from the client and stores it
func handleSendSingleItem(w http.ResponseWriter, r *http.Request) {
	var req SendSingleItemRequest
	if err := parseBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	if req.Conversation == nil && req.Message == nil && len(req.APIKeys) == 0 {
		http.Error(w, "Either conversation, message, or apiKeys must be provided", http.StatusBadRequest)
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	// Get or create user data
	userData, exists := storage[req.Token]
	if !exists {
		userData = UserData{
			Conversations: make(map[string]Conversation),
			Messages:      make(map[string]Message),
			APIKeys:       make(map[string]string),
		}
	}

	// Add conversation if provided
	if req.Conversation != nil {
		conv := *req.Conversation
		id, ok := conv["id"].(string)
		if !ok || id == "" {
			http.Error(w, "Conversation ID is required", http.StatusBadRequest)
			return
		}

		// Check if there's a tombstone for this id
		if existingConv, exists := userData.Conversations[id]; exists {
			if deleted, ok := existingConv["deleted"].(bool); ok && deleted {
				// This is a tombstone, don't resurrect the item
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(SendSingleItemResponse{Success: true})
				return
			}

			// This is an update, mark as Modified
			conv["modified"] = true
		}
		userData.Conversations[id] = conv
	}

	// Add message if provided
	if req.Message != nil {
		msg := *req.Message
		id, ok := msg["id"].(string)
		if !ok || id == "" {
			http.Error(w, "Message ID is required", http.StatusBadRequest)
			return
		}

		// Check if there's a tombstone for this id
		if existingMsg, exists := userData.Messages[id]; exists {
			if deleted, ok := existingMsg["deleted"].(bool); ok && deleted {
				// This is a tombstone, don't resurrect the item
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(SendSingleItemResponse{Success: true})
				return
			}

			// This is an update, mark as Modified
			msg["modified"] = true
		}
		userData.Messages[id] = msg
	}

	// Add API keys if provided
	if len(req.APIKeys) > 0 {
		// Replace the entire APIKeys map
		userData.APIKeys = req.APIKeys
	}

	// Update storage
	storage[req.Token] = userData

	// Save to file after updates
	go saveStorageToFile()

	resp := SendSingleItemResponse{
		Success: true,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// handleDeleteSingleItem deletes a single conversation or message
func handleDeleteSingleItem(w http.ResponseWriter, r *http.Request) {
	var req DeleteSingleItemRequest
	if err := parseBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	if req.ConversationId == "" && req.MessageId == "" {
		http.Error(w, "Either conversationId or messageId must be provided", http.StatusBadRequest)
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	// Get user data
	userData, exists := storage[req.Token]
	if !exists {
		// User doesn't exist, nothing to delete
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(DeleteSingleItemResponse{Success: true})
		return
	}

	// Create tombstone for conversation if provided
	if req.ConversationId != "" {
		// Check if it exists first
		if _, ok := userData.Conversations[req.ConversationId]; ok {
			// Create a tombstone instead of deleting
			userData.Conversations[req.ConversationId] = Conversation{
				"id":        req.ConversationId,
				"deleted":   true,
				"deletedAt": time.Now().Unix(),
			}
		}
	}

	// Create tombstone for message if provided
	if req.MessageId != "" {
		// Check if it exists first
		if _, ok := userData.Messages[req.MessageId]; ok {
			// Create a tombstone instead of deleting
			userData.Messages[req.MessageId] = Message{
				"id":        req.MessageId,
				"deleted":   true,
				"deletedAt": time.Now().Unix(),
			}
		}
	}

	// Update storage
	storage[req.Token] = userData

	// Save to file after updates
	go saveStorageToFile()

	resp := DeleteSingleItemResponse{
		Success: true,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// parseBody extracts and parses JSON from the request body
func parseBody(r *http.Request, v interface{}) error {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("failed to read request body: %v", err)
	}
	defer r.Body.Close()

	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("failed to parse JSON: %v", err)
	}

	return nil
}

// saveStorageToFile persists the in-memory storage to a file
func saveStorageToFile() {
	mutex.RLock()
	defer mutex.RUnlock()

	data, err := json.Marshal(storage)
	if err != nil {
		log.Printf("Failed to marshal storage data: %v", err)
		return
	}

	// Write to a temporary file first for atomic replacement
	tempFile := "storage.json.temp"
	if err := os.WriteFile(tempFile, data, 0644); err != nil {
		log.Printf("Failed to write temporary storage file: %v", err)
		return
	}

	// Rename to do an atomic replace (safer)
	if err := os.Rename(tempFile, "storage.json"); err != nil {
		log.Printf("Failed to rename storage file: %v", err)
	}
}

// loadStorageFromFile loads the storage data from file into memory
func loadStorageFromFile() {
	data, err := os.ReadFile("storage.json")
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Failed to read storage file: %v", err)
		}
		return
	}

	mutex.Lock()
	defer mutex.Unlock()

	if err := json.Unmarshal(data, &storage); err != nil {
		log.Printf("Failed to unmarshal storage data: %v", err)
	}
}

// getEnv gets an environment variable with a fallback value
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
