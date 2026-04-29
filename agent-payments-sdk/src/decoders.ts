import { OFFLINE_PUMP_PROGRAM } from "./program";
import type {
  GlobalConfig,
  TokenAgentPaymentInCurrency,
  TokenAgentPayments,
} from "./types";

export function decodeGlobalConfig(accountData: Buffer): GlobalConfig {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "globalConfig",
    accountData,
  );
}

export function decodeTokenAgentPaymentInCurrency(
  accountData: Buffer,
): TokenAgentPaymentInCurrency {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "tokenAgentPaymentInCurrency",
    accountData,
  );
}

export function decodeTokenAgentPayments(
  accountData: Buffer,
): TokenAgentPayments {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "tokenAgentPayments",
    accountData,
  );
}
