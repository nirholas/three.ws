#!/bin/bash
set -e

# ---
# Claude - Agent Command-Line Interface
# ---
# This script provides a set of commands to streamline agent development and
# management. It's a single entry point for various SDK and agent-related
# tasks.
#
# Usage: ./claude.sh [COMMAND]
#
# Commands:
#   install-sdk   Install and build the local agent SDKs.
#   help          Show this help message.
# ---

# --- Configuration ---
# Root directory of the project
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Helper Functions ---
function print_header() {
  echo "--- $1 ---"
}

function print_success() {
  echo "✅ Success: $1"
}

# --- Commands ---

# Install and build the local agent SDKs
function install_sdk() {
  print_header "Installing Agent SDK"
  
  # Navigate to the root of the project
  cd "$ROOT_DIR"
  
  # Run the npm script to install and build the SDK
  npm run install:sdk
  
  print_success "Agent SDK installed and built."
}

# Show the help message
function help() {
  # Extract the help text from the script's header comments
  sed -n '/^# ---$/,/^# ---$/p' "$0" | sed 's/^# //g' | sed '1d;$d'
}

# --- Main Command Router ---
function main() {
  # Check if a command was provided
  if [ -z "$1" ]; then
    help
    exit 1
  fi
  
  # Route to the appropriate command
  case "$1" in
    install-sdk)
      install_sdk
      ;;
    help)
      help
      ;;
    *)
      echo "Error: Unknown command '$1'"
      help
      exit 1
      ;;
  esac
}

# --- Script Entry Point ---
main "$@"
