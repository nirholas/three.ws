# Transcription Logger Example

Join an X Space in **listen-only mode** and save a timestamped transcript to a file. The agent never speaks — it only listens and records.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Run with a Space URL:
   ```bash
   npm start https://x.com/i/spaces/1eaKbrPAqbwKX
   ```

## Output

Transcriptions are printed to stdout and appended to `transcript.txt`:

```
[2026-03-23T14:30:00.000Z] Alice: Welcome everyone to today's Space
[2026-03-23T14:30:05.000Z] Bob: Thanks for having me
[2026-03-23T14:30:12.000Z] --- Charlie joined ---
```

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `X_AUTH_TOKEN` | X authentication token | *required* |
| `OPENAI_API_KEY` | OpenAI key for STT | *required* |
| `OUTPUT_FILE` | Transcript output path | `transcript.txt` |


