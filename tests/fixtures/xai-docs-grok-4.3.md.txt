# Grok 4.3

Fast, reliable model with strong tool calling and instruction following capabilities.

## At a glance

- **Modalities:** text, image → text
- **Context window:** 1,000,000 tokens
- **Model name:** `grok-4.3`
- **Aliases:** `grok-4.3-latest`
- **Batch API:** Supported

## Capabilities

- **Function calling:** Yes
- **Structured outputs:** Yes
- **Reasoning:** Yes
- **Reasoning efforts (supported):** `none`, `low`, `medium`, `high`, `xhigh`
- **Reasoning efforts (default):** `low`

## Pricing

| Type | < 200k prompt tokens (per 1M tokens) | ≥ 200k prompt tokens (per 1M tokens) |
| --- | --- | --- |
| Input | $1.25 | $2.50 |
| Cached input | $0.20 | $0.40 |
| Output | $2.50 | $5.00 |

Requests whose prompt reaches 200k tokens are billed at the higher rate for all tokens in the request.

[Batch API](/developers/advanced-api-usage/batch-api) requests are billed at a 20% discount to standard rates.

## Rate limits

| Limit | Value |
| --- | --- |
| Requests per second | 37 |
| Tokens per minute | 10,000,000 |

## Regions

Available in: us-east-1, eu-west-1, us-west-2
