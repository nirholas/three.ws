package toolfns

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"mvdan.cc/sh/v3/expand"
	"mvdan.cc/sh/v3/interp"
	"mvdan.cc/sh/v3/syntax"
)

var executor = NewShellExecutor()

// ShellExecutor maintains shell state between commands
type ShellExecutor struct {
	// Environment variables
	env expand.Environ
	// Current working directory
	dir string
}

// NewShellExecutor creates a new shell executor with default state
func NewShellExecutor() *ShellExecutor {
	dir, err := os.Getwd()
	if err != nil {
		dir = ""
	}

	return &ShellExecutor{
		dir: dir,
		env: expand.ListEnviron(os.Environ()...),
	}
}

// Executes the given bash command and returns the output of the command.
// command: The bash command to execute.
func (s *ShellExecutor) Shell(command string) string {
	// Handle long-running commands with a timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Prepare stdout and stderr capture
	var stdout, stderr bytes.Buffer

	// Parse the command
	parser := syntax.NewParser()
	prog, err := parser.Parse(strings.NewReader(command), "")
	if err != nil {
		return fmt.Sprintf("Parse error: %v", err)
	}

	// Create a new runner for this command execution
	runner, err := interp.New(
		interp.StdIO(nil, &stdout, &stderr),
		interp.Dir(s.dir),
		interp.Env(s.env),
	)
	if err != nil {
		return fmt.Sprintf("Error creating interpreter: %v", err)
	}

	// Execute the command
	runErr := runner.Run(ctx, prog)

	// Check if we hit the timeout
	if ctx.Err() == context.DeadlineExceeded {
		return handleTimeout(command, stdout.String(), stderr.String())
	}

	// After any command, update our state
	s.updateState()

	// Format the output
	return formatOutput(stdout.String(), stderr.String(), runErr)
}

// updateState refreshes environment and working directory after command execution
func (s *ShellExecutor) updateState() {
	// Run a sequence of commands to capture the current shell state
	var stdout bytes.Buffer
	stateRunner, _ := interp.New(
		interp.StdIO(nil, &stdout, nil),
		interp.Dir(s.dir),
		interp.Env(s.env),
	)

	// Get current directory
	parser := syntax.NewParser()
	script := `
pwd
echo "---ENV_SEPARATOR---"
env
`
	prog, _ := parser.Parse(strings.NewReader(script), "")
	stateRunner.Run(context.Background(), prog)

	// Parse the output to get current directory and environment
	parts := strings.Split(stdout.String(), "---ENV_SEPARATOR---")
	if len(parts) >= 2 {
		// Update directory
		newDir := strings.TrimSpace(parts[0])
		if newDir != "" {
			s.dir = newDir
		}

		// Update environment
		envStr := strings.TrimSpace(parts[1])
		if envStr != "" {
			envVars := strings.Split(envStr, "\n")
			s.env = expand.ListEnviron(envVars...)
		}
	}
}

// Handle command timeout with helpful message
func handleTimeout(command, stdout, stderr string) string {
	backgroundCmd := command
	if !strings.HasSuffix(strings.TrimSpace(backgroundCmd), "&") {
		backgroundCmd += " &"
	}

	return fmt.Sprintf(
		"Command timed out after 5 seconds. For long-running commands, use background execution:\n\n"+
			"  %s\n\n"+
			"You can then use standard bash job control:\n"+
			"  jobs    - List background jobs\n"+
			"  fg %%N   - Bring job N to foreground\n"+
			"  bg %%N   - Resume job N in background\n"+
			"  kill %%N - Terminate job N\n\n"+
			"Partial output before timeout:\n%s%s",
		backgroundCmd,
		stdout,
		stderr,
	)
}

// Format command output including stderr and errors
func formatOutput(stdout, stderr string, err error) string {
	var result strings.Builder

	if stdout != "" {
		result.WriteString(stdout)
	}

	if stderr != "" {
		if result.Len() > 0 && !strings.HasSuffix(stdout, "\n") {
			result.WriteString("\n")
		}
		result.WriteString(stderr)
	}

	if err != nil {
		if result.Len() > 0 && !strings.HasSuffix(result.String(), "\n") {
			result.WriteString("\n")
		}
		result.WriteString(fmt.Sprintf("Error: %v", err))
	}

	return result.String()
}
