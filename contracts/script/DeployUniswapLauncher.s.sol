// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ThreeWsUniswapLauncher, INonfungiblePositionManager} from "../src/ThreeWsUniswapLauncher.sol";

/// @notice Deploys ThreeWsUniswapLauncher on Base mainnet, the contract behind the
///         /launch/uniswap lane.
///
/// Every constructor argument is immutable, so the economics are fixed for the life of
/// the deployment. They come from the environment and default to a launcher that charges
/// nothing:
///
///   UNISWAP_LAUNCHER_TREASURY            receives the launch fee and the platform share
///                                        (default: none, which requires both to be zero)
///   UNISWAP_LAUNCHER_FEE_WEI             exact ETH each launch must send (default 0)
///   UNISWAP_LAUNCHER_PLATFORM_SHARE_BPS  share of fees collected from locked positions,
///                                        at most 2000 (default 0)
///
/// Before broadcasting, the script checks that it is on Base and that the Uniswap V3
/// position manager reports the factory and WETH the lane expects. After deploying, it
/// reads every immutable back and prints the command that opens the lane on the API.
///
/// Simulate (no transaction is sent):
///   forge script script/DeployUniswapLauncher.s.sol:DeployUniswapLauncher --rpc-url base -vv
///
/// Deploy (irreversible, owner only):
///   forge script script/DeployUniswapLauncher.s.sol:DeployUniswapLauncher --rpc-url base \
///     --private-key $DEPLOYER_PK --broadcast --verify
contract DeployUniswapLauncher is Script {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    address internal constant POSITION_MANAGER = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;
    address internal constant V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external returns (ThreeWsUniswapLauncher) {
        return deploy(
            vm.envOr("UNISWAP_LAUNCHER_TREASURY", address(0)),
            vm.envOr("UNISWAP_LAUNCHER_FEE_WEI", uint256(0)),
            vm.envOr("UNISWAP_LAUNCHER_PLATFORM_SHARE_BPS", uint256(0))
        );
    }

    /// @notice Checks the chain and the Uniswap deployment, deploys, and verifies every immutable.
    function deploy(address treasury, uint256 launchFeeWei, uint256 shareBps)
        public
        returns (ThreeWsUniswapLauncher launcher)
    {
        require(block.chainid == BASE_CHAIN_ID, "DeployUniswapLauncher: not Base mainnet (8453)");
        require(POSITION_MANAGER.code.length != 0, "DeployUniswapLauncher: no position manager code");
        INonfungiblePositionManager pm = INonfungiblePositionManager(POSITION_MANAGER);
        require(pm.factory() == V3_FACTORY, "DeployUniswapLauncher: unexpected V3 factory");
        require(pm.WETH9() == WETH, "DeployUniswapLauncher: unexpected WETH");
        require(shareBps <= type(uint16).max, "DeployUniswapLauncher: platform share out of range");

        vm.startBroadcast();
        launcher = new ThreeWsUniswapLauncher(POSITION_MANAGER, WETH, treasury, launchFeeWei, uint16(shareBps));
        vm.stopBroadcast();

        require(address(launcher.positionManager()) == POSITION_MANAGER, "readback: positionManager");
        require(address(launcher.v3Factory()) == V3_FACTORY, "readback: v3Factory");
        require(launcher.weth() == WETH, "readback: weth");
        require(launcher.treasury() == treasury, "readback: treasury");
        require(launcher.launchFeeWei() == launchFeeWei, "readback: launchFeeWei");
        require(launcher.platformShareBps() == shareBps, "readback: platformShareBps");

        console.log("ThreeWsUniswapLauncher:", address(launcher));
        console.log("Treasury:              ", treasury);
        console.log("Launch fee (wei):      ", launchFeeWei);
        console.log("Platform share (bps):  ", shareBps);
        console.log("");
        console.log("Open the lane on the API:");
        console.log(
            string.concat(
                "  gcloud run services update three-ws-api --region us-central1 --update-env-vars UNISWAP_LAUNCHER_ADDRESS=",
                vm.toString(address(launcher))
            )
        );
    }
}
