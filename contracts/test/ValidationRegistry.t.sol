// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ValidationRegistry} from "../src/ValidationRegistry.sol";

contract ValidationRegistryTest is Test {
    IdentityRegistry identity;
    ValidationRegistry validation;
    address owner = address(this);
    address validator = address(0xDA11d);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        identity = new IdentityRegistry();
        validation = new ValidationRegistry(address(identity), owner);

        vm.prank(alice);
        identity.register("ipfs://alice");
    }

    function testAddValidator() public {
        validation.addValidator(validator);
        assertTrue(validation.isValidator(validator));
    }

    function testOnlyOwnerCanAddValidator() public {
        vm.prank(bob);
        vm.expectRevert(ValidationRegistry.NotOwner.selector);
        validation.addValidator(validator);
    }

    function testRecordValidation() public {
        validation.addValidator(validator);

        bytes32 proof = keccak256("report-v1");
        vm.prank(validator);
        validation.recordValidation(1, true, proof, "ipfs://report", "glb-schema");

        assertEq(validation.getValidationCount(1), 1);
        ValidationRegistry.Validation memory v = validation.getValidation(1, 0);
        assertEq(v.validator, validator);
        assertTrue(v.passed);
        assertEq(v.proofHash, proof);
        assertEq(v.kind, "glb-schema");
    }

    function testLatestByKind() public {
        validation.addValidator(validator);

        vm.startPrank(validator);
        validation.recordValidation(1, false, keccak256("a"), "", "glb-schema");
        validation.recordValidation(1, true, keccak256("b"), "", "glb-schema");
        validation.recordValidation(1, true, keccak256("c"), "", "a2a-card");
        vm.stopPrank();

        ValidationRegistry.Validation memory latest = validation.getLatestByKind(1, "glb-schema");
        assertTrue(latest.passed);
        assertEq(latest.proofHash, keccak256("b"));

        ValidationRegistry.Validation memory card = validation.getLatestByKind(1, "a2a-card");
        assertEq(card.proofHash, keccak256("c"));
    }

    function testNonValidatorCannotRecord() public {
        vm.prank(bob);
        vm.expectRevert(ValidationRegistry.NotValidator.selector);
        validation.recordValidation(1, true, bytes32(0), "", "glb-schema");
    }

    function testUnknownAgentReverts() public {
        validation.addValidator(validator);
        vm.prank(validator);
        vm.expectRevert(ValidationRegistry.UnknownAgent.selector);
        validation.recordValidation(999, true, bytes32(0), "", "glb-schema");
    }

    function testRemoveValidator() public {
        validation.addValidator(validator);
        validation.removeValidator(validator);
        vm.prank(validator);
        vm.expectRevert(ValidationRegistry.NotValidator.selector);
        validation.recordValidation(1, true, bytes32(0), "", "glb-schema");
    }
}
