// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ThreeWSFactory} from "../ThreeWSFactory.sol";
import {AgentPayments} from "../src/AgentPayments.sol";
import {DeployAgentPaymentsCreate2} from "../script/DeployAgentPaymentsCreate2.s.sol";

/// @dev Proves the one-address-everywhere property of the CREATE2 deploy: the
///      same factory, salt and init code give the same AgentPayments address
///      under different chain ids, and the script's prediction matches reality.
contract AgentPaymentsCreate2Test is Test {
    address internal constant FACTORY = 0x00000000D49195AE81759cd247cFeDD9D0B479df;
    bytes32 internal constant SALT = keccak256("three.ws/AgentPayments/v1");
    address internal constant OWNER = address(0xA11CE);

    DeployAgentPaymentsCreate2 internal script;

    function setUp() public {
        script = new DeployAgentPaymentsCreate2();
        deployCodeTo("ThreeWSFactory.sol:ThreeWSFactory", FACTORY);
    }

    function _deploy(uint256 chainId) internal returns (address) {
        vm.chainId(chainId);
        return ThreeWSFactory(FACTORY).deploy(SALT, script.initCode(OWNER));
    }

    function testSameAddressOnEveryChainId() public {
        address predicted = script.predictAddress(OWNER);
        uint256[6] memory ids = [uint256(1), 8453, 42161, 137, 56, 43114];
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 snap = vm.snapshotState();
            address deployed = _deploy(ids[i]);
            assertEq(deployed, predicted, "address differs on a chain");
            assertEq(AgentPayments(deployed).owner(), OWNER);
            vm.revertToState(snap);
        }
    }

    function testPredictionMatchesTheFactory() public view {
        bytes32 hash = keccak256(script.initCode(OWNER));
        assertEq(ThreeWSFactory(FACTORY).predict(SALT, hash), script.predictAddress(OWNER));
    }

    function testDifferentOwnerGivesDifferentAddress() public view {
        assertTrue(script.predictAddress(OWNER) != script.predictAddress(address(0xB0B)));
    }

    function testRunDeploysAtThePredictedAddress() public {
        vm.setEnv("AGENT_PAYMENTS_OWNER", vm.toString(OWNER));
        address deployed = script.run();
        assertEq(deployed, script.predictAddress(OWNER));
        assertEq(AgentPayments(deployed).owner(), OWNER);
    }

    function testRunRevertsWhenAlreadyDeployed() public {
        vm.setEnv("AGENT_PAYMENTS_OWNER", vm.toString(OWNER));
        script.run();
        vm.expectRevert(bytes("AgentPayments already exists at the predicted address"));
        script.run();
    }

    function testRunRevertsWithoutTheFactory() public {
        vm.setEnv("AGENT_PAYMENTS_OWNER", vm.toString(OWNER));
        vm.etch(FACTORY, "");
        vm.expectRevert(bytes("ThreeWSFactory is not deployed on this chain"));
        script.run();
    }
}
