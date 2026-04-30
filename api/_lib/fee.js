const FEE_BPS = parseInt(process.env.PLATFORM_FEE_BPS ?? '250', 10);

export function getFeeBps() {
	return FEE_BPS;
}

export function calculateFee(grossAmount) {
	const fee = Math.floor((grossAmount * FEE_BPS) / 10_000);
	return { fee, net: grossAmount - fee };
}
