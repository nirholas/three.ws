#!/bin/bash
set -e

# ---
# Claude - Agent Command-Line Interface
# ---
# This script provides a set of commands to streamline agent development and
# management. It's a single entry point for various SDK and agent-related
# tasks.
#
# Usage: ./claude.sh [COMMAND] [OPTIONS]
#
# Commands:
#   install-sdk       Install and build the local agent SDKs.
#   validate-cards    Validate the agent cards.
#   db-migrate        Apply database migrations (with confirmation).
#   db-status         Check the status of database migrations.
#   pump-smoke-test   Run the pump.fun smoke test.
#   seed-skills       Seed the skills from the manifest.
#   test              Run the test suite.
#   format            Format the codebase with Prettier.
#   clean             Clean up build artifacts.
#   deploy            Deploy the project to Vercel (with confirmation).
#   deploy-agent      Package an agent for deployment.
#   help              Show this help message.
# ---

# --- Configuration & Colors ---
# Root directory of the project
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Color codes
COLOR_RESET='\033[0m'
COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[0;33m'
COLOR_BLUE='\033[0;34m'
COLOR_CYAN='\033[0;36m'

# --- Helper Functions ---
function print_header() {
  echo -e "${COLOR_BLUE}--- $1 ---${COLOR_RESET}"
}

function print_success() {
  echo -e "${COLOR_GREEN}✅ Success: $1${COLOR_RESET}"
}

function print_warning() {
  echo -e "${COLOR_YELLOW}⚠️ Warning: $1${COLOR_RESET}"
}

function print_error() {
  echo -e "${COLOR_RED}❌ Error: $1${COLOR_RESET}"
  exit 1
}

function confirm_action() {
  print_warning "$1"
  read -p "Are you sure you want to continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 0
  fi
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
  confirm_action "This will apply all pending migrations to the database."
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

# Run the test suite
function test() {
  print_header "Running Tests"
  cd "$ROOT_DIR"
  npm run test
  print_success "Tests completed."
}

# Format the codebase
function format() {
  print_header "Formatting Code"
  cd "$ROOT_DIR"
  npm run format
  print_success "Codebase formatted."
}

# Clean up build artifacts
function clean() {
  print_header "Cleaning Project"
  cd "$ROOT_DIR"
  npm run clean
  print_success "Project cleaned."
}

# Deploy the project
function deploy() {
  print_header "Deploying Project"
  confirm_action "This will deploy the project to Vercel."
  cd "$ROOT_DIR"
  npm run deploy
  print_success "Project deployed."
}

# Deploy a single agent
function deploy_agent() {
  print_header "Deploying Agent: $1"
  if [ -z "$1" ]; then
    print_error "Agent name not provided."
    echo "Usage: ./claude.sh deploy-agent <agent_name>"
    exit 1
  fi
  cd "$ROOT_DIR"
  node scripts/deploy-agent.mjs "$1"
  print_success "Agent packaged successfully."
}

# Show the help message
function help() {
  # Extract the help text from the script's header comments
  sed -n '/^# ---$/,/^# ---$/p' "$0" | sed 's/^# //g' | sed '1d;$d' | while read -r line; do
    command=$(echo "$line" | awk '{print $1}')
    description=$(echo "$line" | cut -d' ' -f2-)
    printf "  ${COLOR_CYAN}%-18s${COLOR_RESET} %s\n" "$command" "$description"
  done
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
    test)
      test
      ;;
    format)
      format
      ;;
    clean)
      clean
      ;;
    deploy)
      deploy
      ;;
    deploy-agent)
      deploy_agent "$2"
      ;;
    help)
      help
      ;;
    *)
      print_error "Unknown command '$1'"
      help
      ;;
  esac
}

# --- Script Entry Point ---
main "$@"
