// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// A small but complete swap router that tells hooks who started the swap, the way the
/// v4 Universal Router does through `msgSender()`. v4-core's reference PoolSwapTest does
/// not expose the trader, so it cannot exercise a hook that prices by identity.
contract AttributedRouter is IUnlockCallback {
    using CurrencySettler for Currency;

    IPoolManager public immutable manager;
    address public msgSender;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swap(PoolKey memory key, IPoolManager.SwapParams memory params, bytes memory hookData)
        external
        returns (BalanceDelta delta)
    {
        msgSender = msg.sender;
        delta = abi.decode(manager.unlock(abi.encode(msg.sender, key, params, hookData)), (BalanceDelta));
        msgSender = address(0);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        (address payer, PoolKey memory key, IPoolManager.SwapParams memory params, bytes memory hookData) =
            abi.decode(data, (address, PoolKey, IPoolManager.SwapParams, bytes));

        BalanceDelta delta = manager.swap(key, params, hookData);
        if (delta.amount0() < 0) key.currency0.settle(manager, payer, uint128(-delta.amount0()), false);
        if (delta.amount1() < 0) key.currency1.settle(manager, payer, uint128(-delta.amount1()), false);
        if (delta.amount0() > 0) key.currency0.take(manager, payer, uint128(delta.amount0()), false);
        if (delta.amount1() > 0) key.currency1.take(manager, payer, uint128(delta.amount1()), false);
        return abi.encode(delta);
    }
}
