package main

import (
	"encoding/json"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
)

// FileInfo represents information about a file or directory
type FileInfo struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"isDir"`
	Size     int64      `json:"size,omitempty"`
	Children []FileInfo `json:"children,omitempty"`
}

// getFileTree recursively builds a tree structure of files and directories
func getFileTree(path string, rootFlag string) (FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return FileInfo{}, err
	}

	fileInfo := FileInfo{
		Name:  filepath.Base(path),
		Path:  path, // Path is already absolute
		IsDir: info.IsDir(),
	}

	if !fileInfo.IsDir {
		fileInfo.Size = info.Size()
	} else {
		entries, err := ioutil.ReadDir(path)
		if err != nil {
			return FileInfo{}, err
		}

		fileInfo.Children = []FileInfo{}
		for _, entry := range entries {
			childPath := filepath.Join(path, entry.Name())
			child, err := getFileTree(childPath, rootFlag)
			if err != nil {
				return FileInfo{}, err
			}
			fileInfo.Children = append(fileInfo.Children, child)
		}
	}

	return fileInfo, nil
}

// ListDirectory handles the /list_directory endpoint request
func ListDirectory(w http.ResponseWriter, r *http.Request) {
	// Get absolute path of the directory
	absFilesPath, err := filepath.Abs(*filesPath)
	if err != nil {
		http.Error(w, "Error getting absolute path: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Verify the directory exists
	info, err := os.Stat(absFilesPath)
	if err != nil {
		http.Error(w, "Error accessing directory: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !info.IsDir() {
		http.Error(w, absFilesPath+" is not a directory", http.StatusInternalServerError)
		return
	}

	// Use the absolute path for getFileTree
	tree, err := getFileTree(absFilesPath, absFilesPath)
	if err != nil {
		http.Error(w, "Failed to build tree: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ") // Pretty print JSON
	if err := encoder.Encode(tree); err != nil {
		http.Error(w, "Failed to encode JSON: "+err.Error(), http.StatusInternalServerError)
	}
}

func ReadFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "Failed to read file: "+err.Error(), http.StatusInternalServerError)
	}
	w.Header().Set("Content-Type", "text/plain")
	w.Write(data)
}
