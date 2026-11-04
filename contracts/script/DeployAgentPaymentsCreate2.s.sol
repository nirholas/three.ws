// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentPayments} from "../src/AgentPayments.sol";

interface IThreeWSFactory {
    function deploy(bytes32 salt, bytes memory initCode) external returns (address addr);
    function predict(bytes32 salt, bytes32 initCodeHash) external view returns (address);
}

/// @notice Deploys AgentPayments through the live ThreeWSFactory CREATE2 deployer
/// so the engine lands on the SAME address on every chain.
///
/// The constructor takes only `owner` and AgentPayments has no chain-specific
/// immutable, so (factory, salt, init code) fully determines the address. The
/// salt is fixed: keccak256("three.ws/AgentPayments/v1"). Bumping the version
/// string is the only supported way to get a different address.
///
/// Safety: the predicted address is computed locally and cross-checked against
/// the factory's own `predict` before anything is broadcast. The script reverts
/// if code already exists at the address or if the deployed address differs.
///
/// Run (per chain, owner = platform multisig):
///   AGENT_PAYMENTS_OWNER=<multisig> forge script \
///     script/DeployAgentPaymentsCreate2.s.sol:DeployAgentPaymentsCreate2 \
///     --rpc-url $BASE_RPC_URL --private-key $DEPLOYER_PK --broadcast
contract DeployAgentPaymentsCreate2 is Script {
    address internal constant FACTORY = 0x00000000D49195AE81759cd247cFeDD9D0B479df;
    bytes32 internal constant SALT = keccak256("three.ws/AgentPayments/v1");

    function initCode(address owner) public pure returns (bytes memory) {
        return abi.encodePacked(type(AgentPayments).creationCode, abi.encode(owner));
    }

    function predictAddress(address owner) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), FACTORY, SALT, keccak256(initCode(owner))
        )))));
    }

    function run() external returns (address deployed) {
        address owner = vm.envOr("AGENT_PAYMENTS_OWNER", msg.sender);
        require(owner != address(0), "owner is zero");
        require(FACTORY.code.length > 0, "ThreeWSFactory is not deployed on this chain");

        bytes memory code = initCode(owner);
        address predicted = predictAddress(owner);
        require(
            IThreeWSFactory(FACTORY).predict(SALT, keccak256(code)) == predicted,
            "local prediction disagrees with the factory"
        );
        require(predicted.code.length == 0, "AgentPayments already exists at the predicted address");

        vm.startBroadcast();
        deployed = IThreeWSFactory(FACTORY).deploy(SALT, code);
        vm.stopBroadcast();

        require(deployed == predicted, "deployed address differs from the prediction");
        require(AgentPayments(deployed).owner() == owner, "owner mismatch");

        console.log("AgentPayments:", deployed);
        console.log("Owner:        ", owner);
        console.log("Next: setRouterAllowed(router, true), then wire the address into the SDK");
    }
}
