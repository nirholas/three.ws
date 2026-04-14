// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

contract ReputationRegistryTest is Test {
    IdentityRegistry identity;
    ReputationRegistry rep;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA701);

    function setUp() public {
        identity = new IdentityRegistry();
        rep = new ReputationRegistry(address(identity));

        vm.prank(alice);
        identity.register("ipfs://alice");
    }

    function testSubmitAndQuery() public {
        vm.prank(bob);
        rep.submitFeedback(1, 80, "ipfs://review1");

        vm.prank(carol);
        rep.submitFeedback(1, 60, "ipfs://review2");

        (int256 avgX100, uint256 count) = rep.getReputation(1);
        assertEq(count, 2);
        assertEq(avgX100, 7000); // (80+60)/2 * 100
    }

    function testCannotReviewSelf() public {
        vm.prank(alice);
        vm.expectRevert(ReputationRegistry.SelfReviewForbidden.selector);
        rep.submitFeedback(1, 100, "");
    }

    function testCannotReviewTwice() public {
        vm.prank(bob);
        rep.submitFeedback(1, 50, "");

        vm.prank(bob);
        vm.expectRevert(ReputationRegistry.AlreadyReviewed.selector);
        rep.submitFeedback(1, 60, "");
    }

    function testScoreBounds() public {
        vm.prank(bob);
        vm.expectRevert(ReputationRegistry.ScoreOutOfRange.selector);
        rep.submitFeedback(1, 101, "");
    }

    function testUnknownAgentReverts() public {
        vm.prank(bob);
        vm.expectRevert(ReputationRegistry.UnknownAgent.selector);
        rep.submitFeedback(999, 50, "");
    }

    function testNegativeScore() public {
        vm.prank(bob);
        rep.submitFeedback(1, -50, "");
        (int256 avgX100,) = rep.getReputation(1);
        assertEq(avgX100, -5000);
    }

    function testFeedbackRange() public {
        vm.prank(bob);
        rep.submitFeedback(1, 30, "a");
        vm.prank(carol);
        rep.submitFeedback(1, 40, "b");

        ReputationRegistry.Feedback[] memory range = rep.getFeedbackRange(1, 0, 10);
        assertEq(range.length, 2);
        assertEq(range[0].score, int8(30));
        assertEq(range[1].score, int8(40));
    }
}
