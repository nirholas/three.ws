// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployUniswapLauncher} from "../script/DeployUniswapLauncher.s.sol";
import {ThreeWsUniswapLauncher} from "../src/ThreeWsUniswapLauncher.sol";

/// Runs the production deploy script against a Base mainnet fork. Tests call deploy() with
/// explicit arguments instead of vm.setEnv, because the environment is shared by tests that
/// run in parallel. run() is exercised with the variables unset, which is the default path.
/// Run: forge test --match-contract DeployUniswapLauncherTest -vv
contract DeployUniswapLauncherTest is Test {
    DeployUniswapLauncher script;

    function setUp() public {
        try vm.createSelectFork("https://mainnet.base.org") returns (uint256) {}
        catch {
            vm.skip(true);
            return;
        }
        script = new DeployUniswapLauncher();
    }

    function test_defaultsDeployAFreeLauncher() public {
        ThreeWsUniswapLauncher launcher = script.run();
        assertGt(address(launcher).code.length, 0);
        assertEq(address(launcher.positionManager()), 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1);
        assertEq(address(launcher.v3Factory()), 0x33128a8fC17869897dcE68Ed026d694621f6FDfD);
        assertEq(launcher.weth(), 0x4200000000000000000000000000000000000006);
        assertEq(launcher.treasury(), address(0));
        assertEq(launcher.launchFeeWei(), 0);
        assertEq(launcher.platformShareBps(), 0);
    }

    function test_configuresFees() public {
        address treasury = makeAddr("tw-deploy-test-treasury");
        ThreeWsUniswapLauncher launcher = script.deploy(treasury, 0.0005 ether, 1000);
        assertEq(launcher.treasury(), treasury);
        assertEq(launcher.launchFeeWei(), 0.0005 ether);
        assertEq(launcher.platformShareBps(), 1000);
    }

    function test_refusesFeesWithoutTreasury() public {
        vm.expectRevert(ThreeWsUniswapLauncher.TreasuryRequiredForFees.selector);
        script.deploy(address(0), 1, 0);
    }

    function test_refusesShareAboveCap() public {
        vm.expectRevert(ThreeWsUniswapLauncher.PlatformShareTooHigh.selector);
        script.deploy(makeAddr("tw-deploy-test-treasury"), 0, 2001);
    }

    function test_refusesAnotherChain() public {
        vm.chainId(1);
        vm.expectRevert(bytes("DeployUniswapLauncher: not Base mainnet (8453)"));
        script.deploy(address(0), 0, 0);
    }
}
