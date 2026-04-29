// generated @ 2025-03-12T22:10:20+02:00 by gendoc
package toolfns

import "github.com/noonien/codoc"

func init() {
	codoc.Register(codoc.Package{
		ID:   "github.com/nirholas/server/toolfns",
		Name: "toolfns",
		Doc:  "generated @ 2025-03-11T22:54:02+02:00 by gendoc",
		Functions: map[string]codoc.Function{
			"Edit": {
				Name: "Edit",
				Doc:  "This is a tool for editing files. For moving or renaming files, you should generally use the Bash tool with the 'mv' command instead. For larger edits, use the Write tool to overwrite files. For Jupyter notebooks (.ipynb files), use the NotebookEditCell instead.\n\nBefore using this tool:\n\n1. Use the View tool to understand the file's contents and context\n\n2. Verify the directory path is correct (only applicable when creating new files):\n  - Use the LS tool to verify the parent directory exists and is the correct location\n\nTo make a file edit, provide the following:\n1. file_path: The absolute path to the file to modify (must be absolute, not relative)\n2. old_string: The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)\n3. new_string: The edited text to replace the old_string\n\nThe tool will replace ONE occurrence of old_string with new_string in the specified file.\n\nCRITICAL REQUIREMENTS FOR USING THIS TOOL:\n\n1. UNIQUENESS: The old_string MUST uniquely identify the specific instance you want to change. This means:\n  - Include AT LEAST 3-5 lines of context BEFORE the change point\n  - Include AT LEAST 3-5 lines of context AFTER the change point\n  - Include all whitespace, indentation, and surrounding code exactly as it appears in the file\n\n2. SINGLE INSTANCE: This tool can only change ONE instance at a time. If you need to change multiple instances:\n  - Make separate calls to this tool for each instance\n  - Each call must uniquely identify its specific instance using extensive context\n\n3. VERIFICATION: Before using this tool:\n  - Check how many instances of the target text exist in the file\n  - If multiple instances exist, gather enough context to uniquely identify each one\n  - Plan separate tool calls for each instance\n\nWARNING: If you do not follow these requirements:\n  - The tool will fail if old_string matches multiple locations\n  - The tool will fail if old_string doesn't match exactly (including whitespace)\n  - You may change the wrong instance if you don't include enough context\n\nWhen making edits:\n  - Ensure the edit results in idiomatic, correct code\n  - Do not leave the code in a broken state\n  - Always use absolute file paths (starting with /)\n\nIf you want to create a new file, use:\n  - A new file path, including dir name if needed\n  - An empty old_string\n  - The new file's contents as new_string\n\nRemember: when making multiple file edits in a row to the same file, you should prefer to send all edits in a single message with multiple calls to this tool, rather than multiple messages with a single call each.\nfile_path: The absolute path to the file to modify or create\nold_string: The text to replace (empty for new files)\nnew_string: The edited text to replace the old_string",
				Args: []string{
					"file_path",
					"old_string",
					"new_string",
				},
			},
			"NewGroup": {
				Name: "NewGroup",
				Args: []string{
					"name",
					"fns",
				},
			},
			"NewShellExecutor": {
				Name: "NewShellExecutor",
				Doc:  "NewShellExecutor creates a new shell executor with default state",
			},
			"Shell": {
				Name: "Shell",
				Doc:  "Executes the given bash command and returns the output of the command.\nSecond line goes here.\ncommand: The bash command to execute.",
				Args: []string{
					"command",
				},
			},
			"formatOutput": {
				Name: "formatOutput",
				Doc:  "Format command output including stderr and errors",
				Args: []string{
					"stdout",
					"stderr",
					"err",
				},
			},
			"handleTimeout": {
				Name: "handleTimeout",
				Doc:  "Handle command timeout with helpful message",
				Args: []string{
					"command",
					"stdout",
					"stderr",
				},
			},
			"init": {
				Name: "init",
			},
		},
		Structs: map[string]codoc.Struct{
			"ContentTypeResponse": {
				Name: "ContentTypeResponse",
			},
			"Group": {
				Name: "Group",
			},
			"ShellExecutor": {
				Name: "ShellExecutor",
				Doc:  "ShellExecutor maintains shell state between commands",
				Fields: map[string]codoc.Field{
					"dir": {
						Doc: "Current working directory",
					},
					"env": {
						Doc: "Environment variables",
					},
				},
				Methods: map[string]codoc.Function{
					"Shell": {
						Name: "Shell",
						Doc:  "Executes the given bash command and returns the output of the command.\ncommand: The bash command to execute.",
						Args: []string{
							"command",
						},
					},
					"updateState": {
						Name: "updateState",
						Doc:  "updateState refreshes environment and working directory after command execution",
					},
				},
			},
		},
	})
}
