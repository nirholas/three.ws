export default {
  async getPrice(args, ctx) {
    const { coin_id, vs_currency } = args;
    if (!coin_id || !vs_currency) {
      return { ok: false, error: 'coin_id and vs_currency are required' };
    }

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin_id}&vs_currencies=${vs_currency}`;
      const response = await fetch(url);
      if (!response.ok) {
        return { ok: false, error: `API request failed with status ${response.status}` };
      }
      const data = await response.json();
      
      if (data[coin_id] && data[coin_id][vs_currency]) {
        const price = data[coin_id][vs_currency];
        return { ok: true, output: `The current price of ${coin_id} is ${price} ${vs_currency.toUpperCase()}.` };
      } else {
        return { ok: false, error: `Could not retrieve price for ${coin_id} in ${vs_currency}` };
      }
    } catch (error) {
      console.error('Error fetching crypto price:', error);
      return { ok: false, error: 'An error occurred while fetching the price.' };
    }
  }
};
