export function toUiAmount(amountStr: string, decimals: number): string {
  if (decimals === 0) return amountStr;
  const amount = BigInt(amountStr);
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
