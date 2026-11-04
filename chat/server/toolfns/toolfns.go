package toolfns

import (
	"fmt"
	"github.com/byte-sat/llum-tools/tools"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Note: Generated filename is significant. The init function for the generated file must run first.
//go:generate go run github.com/noonien/codoc/cmd/codoc@latest -out generated_toolfns.go -pkg toolfns .

var ToolGroups []*Group

func init() {
	ToolGroups = []*Group{
		NewGroup("System",
			executor.Shell,
			//Shell,
			Edit,
		),
	}
}

type Group struct {
	Name string      `json:"name"`
	Repo *tools.Repo `json:"-"`
}

func NewGroup(name string, fns ...any) *Group {
	repo, err := tools.New(nil, fns...)
	if err != nil {
		log.Fatal(err)
	}
	return &Group{
		Name: name,
		Repo: repo,
	}
}

type ContentTypeResponse struct {
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

// Executes the given bash command and returns the output of the command.
// Second line goes here.
// command: The bash command to execute.
func Shell(command string) string {
	cmd := exec.Command("bash", "-c", command)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return err.Error() + "\n" + string(out)
	}
	return string(out)
}

// This is a tool for editing files. For moving or renaming files, you should generally use the Bash tool with the 'mv' command instead. For larger edits, use the Write tool to overwrite files. For Jupyter notebooks (.ipynb files), use the NotebookEditCell instead.
//
// Before using this tool:
//
// 1. Use the View tool to understand the file's contents and context
//
// 2. Verify the directory path is correct (only applicable when creating new files):
//   - Use the LS tool to verify the parent directory exists and is the correct location
//
// To make a file edit, provide the following:
// 1. file_path: The absolute path to the file to modify (must be absolute, not relative)
// 2. old_string: The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)
// 3. new_string: The edited text to replace the old_string
//
// The tool will replace ONE occurrence of old_string with new_string in the specified file.
//
// CRITICAL REQUIREMENTS FOR USING THIS TOOL:
//
// 1. UNIQUENESS: The old_string MUST uniquely identify the specific instance you want to change. This means:
//   - Include AT LEAST 3-5 lines of context BEFORE the change point
//   - Include AT LEAST 3-5 lines of context AFTER the change point
//   - Include all whitespace, indentation, and surrounding code exactly as it appears in the file
//
// 2. SINGLE INSTANCE: This tool can only change ONE instance at a time. If you need to change multiple instances:
//   - Make separate calls to this tool for each instance
//   - Each call must uniquely identify its specific instance using extensive context
//
// 3. VERIFICATION: Before using this tool:
//   - Check how many instances of the target text exist in the file
//   - If multiple instances exist, gather enough context to uniquely identify each one
//   - Plan separate tool calls for each instance
//
// WARNING: If you do not follow these requirements:
//   - The tool will fail if old_string matches multiple locations
//   - The tool will fail if old_string doesn't match exactly (including whitespace)
//   - You may change the wrong instance if you don't include enough context
//
// When making edits:
//   - Ensure the edit results in idiomatic, correct code
//   - Do not leave the code in a broken state
//   - Always use absolute file paths (starting with /)
//
// If you want to create a new file, use:
//   - A new file path, including dir name if needed
//   - An empty old_string
//   - The new file's contents as new_string
//
// Remember: when making multiple file edits in a row to the same file, you should prefer to send all edits in a single message with multiple calls to this tool, rather than multiple messages with a single call each.
// file_path: The absolute path to the file to modify or create
// old_string: The text to replace (empty for new files)
// new_string: The edited text to replace the old_string
func Edit(file_path, old_string, new_string string) string {
	// Check if the file exists
	_, err := os.Stat(file_path)

	// If old_string is empty, create a new file
	if old_string == "" {
		// Create parent directories if they don't exist
		parentDir := filepath.Dir(file_path)
		if err := os.MkdirAll(parentDir, 0755); err != nil {
			return fmt.Sprintf("Error creating directory %s: %v", parentDir, err)
		}

		// Write the new file
		if err := os.WriteFile(file_path, []byte(new_string), 0644); err != nil {
			return fmt.Sprintf("Error creating file %s: %v", file_path, err)
		}

		return fmt.Sprintf("Successfully created file %s", file_path)
	}

	// File doesn't exist but we're trying to edit it
	if os.IsNotExist(err) {
		return fmt.Sprintf("Error: File %s does not exist", file_path)
	}

	// Read the file content
	content, err := os.ReadFile(file_path)
	if err != nil {
		return fmt.Sprintf("Error reading file %s: %v", file_path, err)
	}

	fileStr := string(content)

	// Count occurrences of old_string
	count := strings.Count(fileStr, old_string)

	if count == 0 {
		return fmt.Sprintf("Error: Could not find the specified text in file %s", file_path)
	} else if count > 1 {
		return fmt.Sprintf("Error: Found %d occurrences of the specified text in file %s. The text must uniquely identify exactly one location.", count, file_path)
	}

	// Replace the text
	newContent := strings.Replace(fileStr, old_string, new_string, 1)

	// Write the modified content back
	if err := os.WriteFile(file_path, []byte(newContent), 0644); err != nil {
		return fmt.Sprintf("Error writing to file %s: %v", file_path, err)
	}

	return fmt.Sprintf("Successfully edited file %s", file_path)
}
