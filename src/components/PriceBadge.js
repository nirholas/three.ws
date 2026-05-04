
// Mapping of mint addresses to human-readable currency symbols.
const CURRENCY_SYMBOLS = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a': 'USDC',
    'So11111111111111111111111111111111111111112': 'SOL',
};

// Divisors to convert from smallest unit to standard unit.
const CURRENCY_DIVISORS = {
    'USDC': 1e6,
    'SOL': 1e9,
};

export function PriceBadge(price) {
    if (!price || !price.amount) {
        return `<span class="price-badge price-free">Free</span>`;
    }

    const symbol = CURRENCY_SYMBOLS[price.currency_mint] || '???';
    const divisor = CURRENCY_DIVISORS[symbol] || 1;
    const formattedAmount = (price.amount / divisor).toFixed(2);

    return `
        <span class="price-badge price-paid">
            ${formattedAmount} ${symbol}
        </span>
    `;
}
      