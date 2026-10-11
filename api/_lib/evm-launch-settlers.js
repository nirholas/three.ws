// Lane settlers for evm_launch_records: each finishes a launch whose transaction
// was sent but whose request never saw the receipt (api/_lib/evm-launch-records.js).
// Loaded on demand so reading a record does not import every lane.

import { settlePairedLaunch } from './evm-leg/paired-launch.js';
import { settleUniswapLaunch } from './evm-leg/uniswap-launch.js';

export const settlers = { paired: settlePairedLaunch, uniswap: settleUniswapLaunch };
