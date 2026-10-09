// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PairedLaunchpad} from "../src/PairedLaunchpad.sol";

/// @notice Deploy the launchpad and register the stock tokens it can pair against.
///
/// @dev The quote registry is seeded in the same run as the deployment because
/// a launchpad with no enabled quotes is a launchpad where every launch reverts,
/// and discovering that in production is worse than a longer script.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
	/// @notice Starting virtual quote reserve for a full-weight pool, in whole
	/// units of the stock token. Set per stock so a launch against a $100 share
	/// and a $500 share open at a comparable valuation instead of one being 5x
	/// the other purely because of the share price.
	uint128 constant DEFAULT_VIRTUAL_QUOTE = 30e18;

	uint256 constant LAUNCH_FEE = 0.0005 ether;
	uint16 constant SWAP_FEE_BPS = 100; // 1%

	function run() external {
		address treasury = vm.envOr("PAIRED_TREASURY", msg.sender);
		vm.startBroadcast();

		PairedLaunchpad pad = new PairedLaunchpad(treasury, LAUNCH_FEE, SWAP_FEE_BPS);
		console.log("PairedLaunchpad", address(pad));
		console.log("treasury", treasury);

		address[24] memory stocks = [
			0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, // AAPL
			0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, // AMD
			0x12f190a9F9d7D37a250758b26824B97CE941bF54, // AMZN
			0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4, // BABA
			0x822CC93fFD030293E9842c30BBD678F530701867, // BE
			0x6330D8C3178a418788dF01a47479c0ce7CCF450b, // COIN
			0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, // CRCL
			0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3, // CRWV
			0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, // GOOGL
			0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, // INTC
			0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, // META
			0xe93237C50D904957Cf27E7B1133b510C669c2e74, // MSFT
			0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, // MU
			0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, // NVDA
			0xb0992820E760d836549ba69BC7598b4af75dEE03, // ORCL
			0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, // PLTR
			0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, // QQQ
			0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5, // SGOV
			0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, // SLV
			0xB90A19fF0Af67f7779afF50A882A9CfF42446400, // SNDK
			0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, // SPCX
			0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, // SPY
			0x322F0929c4625eD5bAd873c95208D54E1c003b2d, // TSLA
			0xd917B029C761D264c6A312BBbcDA868658eF86a6 // USAR
		];

		for (uint256 i; i < stocks.length; ++i) {
			pad.setQuoteConfig(stocks[i], DEFAULT_VIRTUAL_QUOTE, true);
		}
		console.log("quote markets enabled", stocks.length);

		vm.stopBroadcast();

		console.log("");
		console.log("Set these and redeploy the apps:");
		console.log("  PAIRED_LAUNCHPAD / VITE_LAUNCHPAD =", address(pad));
	}
}
