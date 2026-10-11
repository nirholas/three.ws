// Admin reconciliation: for each pool, does the chain agree with our ledger, and
// does the vault hold exactly what the program says it should?
//
// Invariant (all BigInt base units):
//   vault balance == totalStaked - feePaid - paidOut
//   chain totalStaked == sum of recorded stakes
//   chain paidOut == sum of recorded claims and refunds
// Rounding dust left after every claim is part of totalStaked - feePaid - paidOut,
// so it is not a discrepancy. A short vault is the alarm case; a surplus means
// tokens were sent to the vault outside the program (harmless, but reported).

export function reconcilePool({ chain, vaultBalance, ledger }) {
	const expectedVault = chain.totalStaked - chain.feePaid - chain.paidOut;
	const problems = [];
	if (vaultBalance < expectedVault) problems.push({ code: 'vault_short', delta: (expectedVault - vaultBalance).toString() });
	if (vaultBalance > expectedVault) problems.push({ code: 'vault_surplus', delta: (vaultBalance - expectedVault).toString() });
	if (chain.totalStaked !== ledger.staked) problems.push({ code: 'ledger_stake_mismatch', delta: (chain.totalStaked - ledger.staked).toString() });
	if (chain.paidOut !== ledger.paidOut) problems.push({ code: 'ledger_payout_mismatch', delta: (chain.paidOut - ledger.paidOut).toString() });
	return {
		ok: problems.length === 0,
		expected_vault: expectedVault.toString(),
		vault: vaultBalance.toString(),
		chain_total_staked: chain.totalStaked.toString(),
		ledger_staked: ledger.staked.toString(),
		chain_paid_out: chain.paidOut.toString(),
		ledger_paid_out: ledger.paidOut.toString(),
		problems,
	};
}
