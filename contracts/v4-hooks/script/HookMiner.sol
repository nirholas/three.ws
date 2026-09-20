// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Finds a CREATE2 salt that puts a hook at an address whose low 14 bits equal the
///         permission flags the hook declares. Uniswap v4 reads a hook's permissions from
///         its address, so a hook deployed anywhere else is rejected by its own constructor.
library HookMiner {
    uint160 internal constant FLAG_MASK = (1 << 14) - 1;
    uint256 internal constant MAX_ITERATIONS = 500_000;

    error SaltNotFound();

    function find(address deployer, uint160 flags, bytes memory creationCodeWithArgs)
        internal
        view
        returns (address hook, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(creationCodeWithArgs);
        for (uint256 i; i < MAX_ITERATIONS; ++i) {
            salt = bytes32(i);
            hook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
            if (uint160(hook) & FLAG_MASK == flags && hook.code.length == 0) return (hook, salt);
        }
        revert SaltNotFound();
    }
}
