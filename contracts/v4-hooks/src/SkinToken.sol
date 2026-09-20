// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SkinToken
/// @notice One wearable 3D item, as a fixed-supply ERC-20. Holding one whole token is the
///         right to wear the item; `SkinHook.equip` is what actually puts it on.
/// @dev No owner, no mint, no pause. The whole supply is minted once to the launching hook,
///      which seeds it into the pool. The model is pinned by hash at construction, so the
///      item people bought can never be swapped for a different mesh.
contract SkinToken is ERC20 {
    /// @notice Where the GLB lives (https, ipfs or ar URI).
    string public modelURI;
    /// @notice keccak256 of the GLB bytes. A renderer must refuse a file that does not match.
    bytes32 public immutable modelHash;
    /// @notice Avatar slot this item occupies, for example "head", "torso", "back".
    string public slot;
    /// @notice The address that launched the item and earns its royalty.
    address public immutable creator;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply,
        string memory modelURI_,
        bytes32 modelHash_,
        string memory slot_,
        address creator_
    ) ERC20(name_, symbol_) {
        modelURI = modelURI_;
        modelHash = modelHash_;
        slot = slot_;
        creator = creator_;
        _mint(msg.sender, supply);
    }
}
