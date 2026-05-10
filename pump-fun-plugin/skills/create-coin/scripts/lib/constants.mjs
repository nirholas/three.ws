/** Align with frontend/apps/frontend/stores/blockchainStore/constants.ts */
export const CREATE_DEFAULT_UNITS = 270_000;
export const BUY_SELL_DEFAULT_UNITS = 120_000;
export const AMM_BUY_SELL_DEFAULT_UNITS = 200_000;

/** Create + initial buy on one tx */
export const CREATE_AND_BUY_COMPUTE_UNITS =
  CREATE_DEFAULT_UNITS + BUY_SELL_DEFAULT_UNITS;

/** Default Address Lookup Tables per network */
export const ALT_ADDRESS_MAINNET = "7mFD2mUtRS65XstiSAvCJuYmdesZoQwCwRJhq1p3eRMe";
export const ALT_ADDRESS_DEVNET = "7y3623xaVQzsLxHRyp1wQD4Pmer5JjgbaagGFAEqCjua";
