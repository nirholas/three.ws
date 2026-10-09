/**
 * Creator-fee sweeps for one coin.
 *
 * Since pump-sdk 4.0 (the v3 bonding-curve and v2 PumpSwap trade instructions),
 * a trade can leave its creator fee on the bonding curve (`creatorFee`) or in
 * the canonical pool (`creatorFees`) instead of paying the creator vault. A
 * collect only drains the vault, and a distribution is refused with
 * `CreatorFeesNotSwept` while either bucket is nonzero, so both builders put
 * these permissionless sweeps first.
 * Docs: https://github.com/pump-fun/pump-public-docs/blob/main/docs/SWEEP_FEES.md
 */
import {
  PUMP_SDK,
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  normalizeQuoteMint,
} from "@pump-fun/pump-sdk";
import { PumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import { NATIVE_MINT } from "@solana/spl-token";

/**
 * Sweep instructions for every nonzero creator-fee bucket of `mint`.
 *
 * @param {import("@solana/web3.js").Connection} connection
 * @param {object} o
 * @param {import("@solana/web3.js").PublicKey} o.mint
 * @param {import("@solana/web3.js").PublicKey} o.payer   signs and pays any vault rent
 * @param {import("@solana/web3.js").PublicKey} [o.recipient]  only sweep buckets owed to this creator
 * @returns {Promise<{ instructions: import("@solana/web3.js").TransactionInstruction[], swept: Array<{ source: "curve" | "pool", recipient: string, quoteMint: string, amount: string }> }>}
 */
export async function coinCreatorFeeSweeps(connection, { mint, payer, recipient }) {
  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint));
  const curve = curveInfo ? PUMP_SDK.decodeBondingCurveNullable(curveInfo) : null;
  if (!curve) return { instructions: [], swept: [] };

  const quoteMint = normalizeQuoteMint(curve.quoteMint);
  const legs = [];
  if (!curve.creatorFee.isZero()) {
    legs.push({ source: "curve", recipient: curve.creator, quoteMint, amount: curve.creatorFee });
  }
  if (curve.complete) {
    const poolInfo = await connection.getAccountInfo(canonicalPumpPoolPdaWithQuote(mint, quoteMint));
    const pool = poolInfo ? new PumpAmmSdk().decodePoolNullable(poolInfo) : null;
    if (pool && !pool.creatorFees.isZero()) {
      legs.push({ source: "pool", recipient: pool.coinCreator, quoteMint: pool.quoteMint, amount: pool.creatorFees });
    }
  }
  const owed = recipient ? legs.filter((l) => l.recipient.equals(recipient)) : legs;
  if (!owed.length) return { instructions: [], swept: [] };

  let quoteTokenProgram;
  if (!quoteMint.equals(NATIVE_MINT)) {
    const quoteInfo = await connection.getAccountInfo(quoteMint);
    if (!quoteInfo) throw new Error(`Quote mint ${quoteMint.toBase58()} not found on-chain.`);
    quoteTokenProgram = quoteInfo.owner;
  }

  const instructions = [];
  for (const leg of owed) {
    instructions.push(
      leg.source === "curve"
        ? await PUMP_SDK.sweepCreatorFeeInstruction({ payer, mint, creator: leg.recipient, quoteMint: leg.quoteMint, quoteTokenProgram })
        : await PUMP_SDK.sweepPoolCreatorFeeInstruction({ payer, mint, coinCreator: leg.recipient, quoteMint: leg.quoteMint, quoteTokenProgram }),
    );
  }
  return {
    instructions,
    swept: owed.map((l) => ({
      source: l.source,
      recipient: l.recipient.toBase58(),
      quoteMint: l.quoteMint.toBase58(),
      amount: l.amount.toString(),
    })),
  };
}
