// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * SDK error types for multi-currency / USDC-aware PumpAgent flows.
 */

/**
 * Thrown when a Jupiter v6 API call fails (network error, non-2xx status,
 * or malformed response). Callers should surface this so operators can
 * either retry, swap providers, or feed in their own pre-built swap data.
 */
export class JupiterUnavailableError extends Error {
  readonly status?: number;
  readonly endpoint: string;

  constructor(message: string, endpoint: string, status?: number) {
    super(message);
    this.name = "JupiterUnavailableError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

/**
 * Thrown when a pump-fun coin's quote mint is not present in the
 * agent-payments program's `GlobalConfig.supportedCurrenciesMint` list.
 *
 * Actionable resolution: ask a protocol authority to add the currency
 * via `globalAddNewCurrency`, or pick a different coin whose quote mint
 * is already supported.
 */
export class CurrencyNotSupportedError extends Error {
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly supportedMints: string[];

  constructor(params: {
    baseMint: string;
    quoteMint: string;
    supportedMints: string[];
  }) {
    super(
      `Coin ${params.baseMint} uses quote mint ${params.quoteMint}, ` +
        `which is not in GlobalConfig.supportedCurrenciesMint ` +
        `(supported: ${
          params.supportedMints.length === 0
            ? "<none>"
            : params.supportedMints.join(", ")
        }). Add the currency to GlobalConfig before accepting payments.`,
    );
    this.name = "CurrencyNotSupportedError";
    this.baseMint = params.baseMint;
    this.quoteMint = params.quoteMint;
    this.supportedMints = params.supportedMints;
  }
}
