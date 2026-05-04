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
#   install-sdk       Install and build the local agent SDKs.
#   validate-cards    Validate the agent cards.
#   db-migrate        Apply database migrations.
#   db-status         Check the status of database migrations.
#   pump-smoke-test   Run the pump.fun smoke test.
#   seed-skills       Seed the skills from the manifest.
#   help              Show this help message.
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

# Validate the agent cards
function validate_cards() {
  print_header "Validating Agent Cards"
  cd "$ROOT_DIR"
  npm run validate:cards
  print_success "Agent cards validated."
}

# Apply database migrations
function db_migrate() {
  print_header "Applying Database Migrations"
  cd "$ROOT_DIR"
  npm run db:migrate
  print_success "Database migrations applied."
}

# Check the status of database migrations
function db_status() {
  print_header "Checking Database Migration Status"
  cd "$ROOT_DIR"
  npm run db:status
}

# Run the pump.fun smoke test
function pump_smoke_test() {
  print_header "Running Pump.fun Smoke Test"
  cd "$ROOT_DIR"
  npm run pump:smoke
  print_success "Pump.fun smoke test completed."
}

# Seed the skills from the manifest
function seed_skills() {
  print_header "Seeding Skills"
  cd "$ROOT_DIR"
  npm run seed:skills
  print_success "Skills seeded."
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
    validate-cards)
      validate_cards
      ;;
    db-migrate)
      db_migrate
      ;;
    db-status)
      db_status
      ;;
    pump-smoke-test)
      pump_smoke_test
      ;;
    seed-skills)
      seed_skills
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
