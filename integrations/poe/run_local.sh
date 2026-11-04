#!/usr/bin/env bash
# Run the bot locally without an access key (Poe's own checks are skipped).
# Expose it to the Poe creator dashboard with a tunnel such as ngrok.
set -euo pipefail
cd "$(dirname "$0")"
python -m pip install -q -r requirements.txt
exec python forge_bot.py
