// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry reg;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 alicePk = 0xA11CE;

    function setUp() public {
        reg = new IdentityRegistry();
        alice = vm.addr(alicePk);
    }

    function testRegisterAssignsIncrementingIds() public {
        vm.prank(alice);
        uint256 id1 = reg.register("ipfs://abc");
        assertEq(id1, 1);

        vm.prank(bob);
        uint256 id2 = reg.register("ipfs://def");
        assertEq(id2, 2);

        assertEq(reg.ownerOf(1), alice);
        assertEq(reg.ownerOf(2), bob);
        assertEq(reg.tokenURI(1), "ipfs://abc");
        assertEq(reg.tokenURI(2), "ipfs://def");
        assertEq(reg.totalSupply(), 2);
    }

    function testRegisterEmptyURI() public {
        vm.prank(alice);
        uint256 id = reg.register();
        assertEq(id, 1);
        assertEq(reg.tokenURI(1), "");
    }

    function testRegisterWithMetadata() public {
        IdentityRegistry.MetadataEntry[] memory m = new IdentityRegistry.MetadataEntry[](2);
        m[0] = IdentityRegistry.MetadataEntry("role", bytes("agent"));
        m[1] = IdentityRegistry.MetadataEntry("ver", bytes("1.0"));

        vm.prank(alice);
        uint256 id = reg.register("ipfs://x", m);

        assertEq(reg.getMetadata(id, "role"), bytes("agent"));
        assertEq(reg.getMetadata(id, "ver"), bytes("1.0"));
    }

    function testSetAgentURIOnlyOwner() public {
        vm.prank(alice);
        uint256 id = reg.register("ipfs://old");

        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.NotAgentOwner.selector);
        reg.setAgentURI(id, "ipfs://hacked");

        vm.prank(alice);
        reg.setAgentURI(id, "ipfs://new");
        assertEq(reg.tokenURI(id), "ipfs://new");
    }

    function testSetMetadataOnlyOwner() public {
        vm.prank(alice);
        uint256 id = reg.register("ipfs://x");

        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.NotAgentOwner.selector);
        reg.setMetadata(id, "k", bytes("v"));

        vm.prank(alice);
        reg.setMetadata(id, "k", bytes("v"));
        assertEq(reg.getMetadata(id, "k"), bytes("v"));
    }

    function testSetAgentWalletWithValidSignature() public {
        vm.prank(alice);
        uint256 id = reg.register("ipfs://x");

        uint256 deadline = block.timestamp + 1 days;
        address delegate = address(0xDE1);
        uint256 nonce = reg.nonces(alice);

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 nonce,uint256 deadline)"),
                id,
                delegate,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", reg.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        reg.setAgentWallet(id, delegate, deadline, sig);
        assertEq(reg.getAgentWallet(id), delegate);
        assertEq(reg.nonces(alice), nonce + 1);
    }

    function testSetAgentWalletExpired() public {
        vm.prank(alice);
        uint256 id = reg.register("ipfs://x");

        vm.warp(1000);
        vm.expectRevert(IdentityRegistry.SignatureExpired.selector);
        reg.setAgentWallet(id, address(0xDE1), 500, hex"");
    }

    function testGetAgentWalletFallsBackToOwner() public {
        vm.prank(alice);
        uint256 id = reg.register("ipfs://x");
        assertEq(reg.getAgentWallet(id), alice);
    }

    function testUnsetAgentWallet() public {
        testSetAgentWalletWithValidSignature();
        vm.prank(alice);
        reg.unsetAgentWallet(1);
        assertEq(reg.getAgentWallet(1), alice);
    }

    function testTokenURIUnknownReverts() public {
        vm.expectRevert();
        reg.tokenURI(999);
    }

    function testIsAgent() public {
        assertFalse(reg.isAgent(1));
        vm.prank(alice);
        reg.register("ipfs://x");
        assertTrue(reg.isAgent(1));
    }
}
