// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {IERC8004Identity, IERC8004Reputation, IMsgSender} from "./interfaces/IERC8004.sol";

/// @title AgentTierHook
/// @notice Pools where an ERC-8004 agent's standing sets the LP fee it pays. An unknown
///         trader pays the base fee, a registered agent pays less, and an agent whose
///         reputation clears the pool's bar pays the least. LPs keep every fee; the hook
///         never takes or holds value.
/// @dev Reads the canonical ERC-8004 registries directly. There is nothing to register
///      with this hook: the trader names an `agentId` in `hookData` and the hook checks
///      that the trader controls it.
///
///      Three rules shape the design.
///      1. Reputation needs a named reviewer set. The live registry refuses an empty one,
///         so each pool configures the reviewers whose feedback it trusts.
///      2. Swaps stay O(1). Summarising reputation loops over reviewers and feedback, so
///         it happens in the permissionless `refreshTier`, which caches the result with an
///         expiry. `beforeSwap` only reads the cache.
///      3. Every failure resolves to the base fee. The registries are upgradeable proxies
///         whose interface has already changed once, so each registry call is gas-capped
///         and wrapped in try/catch. A broken, hostile or upgraded registry can cost an
///         agent its discount. It can never block a swap or grant a discount.
contract AgentTierHook is IHooks {
    using PoolIdLibrary for PoolKey;

    uint24 public constant MAX_FEE = 100_000; // 10%
    uint256 public constant MAX_REVIEWERS = 16;
    uint32 public constant MIN_TTL = 1 hours;
    uint32 public constant MAX_TTL = 30 days;
    /// @dev Enough for an ERC-721 `ownerOf` behind a proxy, far too little to grief a swap.
    uint256 internal constant IDENTITY_CALL_GAS = 60_000;

    IPoolManager public immutable poolManager;
    IERC8004Identity public immutable identity;
    IERC8004Reputation public immutable reputation;

    struct TierConfig {
        uint24 baseFee; // anyone
        uint24 agentFee; // trader controls a registered agent
        uint24 trustedFee; // and that agent's cached reputation clears the bar
        uint64 minCount; // feedback entries required from the reviewer set
        int256 minScore; // required average, 18-decimal fixed point
        uint32 ttl; // how long a refreshed tier stays valid
        string tag1; // optional ERC-8004 feedback tag filters
        string tag2;
    }

    struct Pool {
        address admin;
        uint32 epoch; // bumped when the bar or reviewer set changes, which voids the cache
        TierConfig config;
        address[] reviewers;
    }

    struct CachedTier {
        bool trusted;
        uint64 expiry;
    }

    mapping(PoolId => Pool) internal _pools;
    /// @notice Routers whose `msgSender()` a pool believes. A router that lies about the
    ///         trader could hand anyone a discount, so this is opt-in per pool.
    mapping(PoolId => mapping(address => bool)) public trustedRouter;
    mapping(PoolId => mapping(uint32 => mapping(uint256 => CachedTier))) internal _tiers;

    event PoolCreated(PoolId indexed poolId, address indexed admin, Currency currency0, Currency currency1);
    event ConfigChanged(PoolId indexed poolId, uint32 epoch);
    event RouterTrustChanged(PoolId indexed poolId, address indexed router, bool trusted);
    event AdminChanged(PoolId indexed poolId, address indexed previous, address indexed current);
    event TierRefreshed(
        PoolId indexed poolId, uint256 indexed agentId, bool trusted, uint64 count, int256 score, uint64 expiry
    );

    error NotPoolManager();
    error NotPoolAdmin();
    error OnlyThisHookCreatesPools();
    error HookNotImplemented();
    error UnknownPool();
    error InvalidFees();
    error InvalidTtl();
    error InvalidReviewers();
    error ZeroAddress();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyAdmin(PoolId poolId) {
        if (msg.sender != _pools[poolId].admin) revert NotPoolAdmin();
        _;
    }

    constructor(IPoolManager poolManager_, IERC8004Identity identity_, IERC8004Reputation reputation_) {
        if (address(identity_) == address(0) || address(reputation_) == address(0)) revert ZeroAddress();
        poolManager = poolManager_;
        identity = identity_;
        reputation = reputation_;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ------------------------------------------------------------------ pool setup

    /// @notice Create a dynamic-fee pool governed by this hook. The caller becomes its admin.
    /// @dev The hook initializes the pool itself. v4 skips callbacks for a hook's own calls,
    ///      so `beforeInitialize` only ever runs for an outsider and always reverts: a pool
    ///      cannot exist under this hook without a config.
    function createPool(
        Currency currency0,
        Currency currency1,
        int24 tickSpacing,
        uint160 sqrtPriceX96,
        TierConfig calldata config,
        address[] calldata reviewers,
        address[] calldata routers
    ) external returns (PoolKey memory key) {
        _validate(config, reviewers);
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(this))
        });
        PoolId poolId = key.toId();

        Pool storage pool = _pools[poolId];
        pool.admin = msg.sender;
        pool.config = config;
        pool.reviewers = reviewers;
        for (uint256 i; i < routers.length; ++i) {
            trustedRouter[poolId][routers[i]] = true;
            emit RouterTrustChanged(poolId, routers[i], true);
        }

        poolManager.initialize(key, sqrtPriceX96);
        emit PoolCreated(poolId, msg.sender, currency0, currency1);
    }

    /// @notice Change the bar or the reviewer set. Every cached tier for the pool is voided.
    function setConfig(PoolId poolId, TierConfig calldata config, address[] calldata reviewers)
        external
        onlyAdmin(poolId)
    {
        _validate(config, reviewers);
        Pool storage pool = _pools[poolId];
        pool.config = config;
        pool.reviewers = reviewers;
        emit ConfigChanged(poolId, ++pool.epoch);
    }

    function setTrustedRouter(PoolId poolId, address router, bool trusted) external onlyAdmin(poolId) {
        trustedRouter[poolId][router] = trusted;
        emit RouterTrustChanged(poolId, router, trusted);
    }

    function setAdmin(PoolId poolId, address admin) external onlyAdmin(poolId) {
        if (admin == address(0)) revert ZeroAddress();
        emit AdminChanged(poolId, msg.sender, admin);
        _pools[poolId].admin = admin;
    }

    function _validate(TierConfig calldata config, address[] calldata reviewers) internal pure {
        if (config.baseFee > MAX_FEE || config.agentFee > config.baseFee || config.trustedFee > config.agentFee) {
            revert InvalidFees();
        }
        if (config.ttl < MIN_TTL || config.ttl > MAX_TTL) revert InvalidTtl();
        if (reviewers.length == 0 || reviewers.length > MAX_REVIEWERS) revert InvalidReviewers();
        for (uint256 i; i < reviewers.length; ++i) {
            if (reviewers[i] == address(0)) revert InvalidReviewers();
        }
    }

    // ------------------------------------------------------------------ reputation cache

    /// @notice Recompute and cache an agent's tier for a pool. Anyone may call it; the agent
    ///         that wants the discount has the incentive to.
    function refreshTier(PoolId poolId, uint256 agentId) external returns (bool trusted) {
        Pool storage pool = _pools[poolId];
        if (pool.admin == address(0)) revert UnknownPool();
        TierConfig storage config = pool.config;

        uint64 count;
        int256 score;
        try reputation.getSummary(agentId, pool.reviewers, config.tag1, config.tag2) returns (
            uint64 count_, int128 value, uint8 decimals
        ) {
            count = count_;
            // The registry bounds decimals to 18; anything else is not a score this hook trusts.
            if (decimals <= 18) score = int256(value) * int256(10 ** uint256(18 - decimals));
            else count = 0;
        } catch {
            count = 0;
        }

        trusted = count != 0 && count >= config.minCount && score >= config.minScore;
        uint64 expiry = uint64(block.timestamp) + config.ttl;
        _tiers[poolId][pool.epoch][agentId] = CachedTier({trusted: trusted, expiry: expiry});
        emit TierRefreshed(poolId, agentId, trusted, count, score, expiry);
    }

    // ------------------------------------------------------------------ views

    function poolAdmin(PoolId poolId) external view returns (address) {
        return _pools[poolId].admin;
    }

    function poolConfig(PoolId poolId) external view returns (TierConfig memory config, uint32 epoch) {
        return (_pools[poolId].config, _pools[poolId].epoch);
    }

    function poolReviewers(PoolId poolId) external view returns (address[] memory) {
        return _pools[poolId].reviewers;
    }

    function cachedTier(PoolId poolId, uint256 agentId) external view returns (bool trusted, uint64 expiry) {
        CachedTier storage tier = _tiers[poolId][_pools[poolId].epoch][agentId];
        return (tier.trusted, tier.expiry);
    }

    /// @notice The LP fee `trader` would pay right now, swapping as `agentId` through a
    ///         router this pool trusts.
    function quoteFee(PoolId poolId, address trader, uint256 agentId) external view returns (uint24) {
        return _feeFor(poolId, trader, agentId);
    }

    // ------------------------------------------------------------------ swap callback

    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata hookData)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        uint24 fee = _pools[poolId].config.baseFee;

        // A discount needs three things: a 32-byte agentId, a router this pool trusts, and
        // that router naming a trader. Missing any of them is an ordinary base-fee swap.
        if (hookData.length == 32 && trustedRouter[poolId][sender]) {
            address trader = _traderOf(sender);
            if (trader != address(0)) fee = _feeFor(poolId, trader, uint256(bytes32(hookData[:32])));
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _traderOf(address router) internal view returns (address trader) {
        try IMsgSender(router).msgSender{gas: IDENTITY_CALL_GAS}() returns (address trader_) {
            trader = trader_;
        } catch {}
    }

    function _feeFor(PoolId poolId, address trader, uint256 agentId) internal view returns (uint24) {
        Pool storage pool = _pools[poolId];
        TierConfig storage config = pool.config;
        if (!_controls(trader, agentId)) return config.baseFee;

        CachedTier storage tier = _tiers[poolId][pool.epoch][agentId];
        if (tier.trusted && tier.expiry >= block.timestamp) return config.trustedFee;
        return config.agentFee;
    }

    /// @dev The trader controls the agent if it owns the identity NFT or is the agent's
    ///      verified operating wallet. Either registry call failing counts as "no".
    function _controls(address trader, uint256 agentId) internal view returns (bool) {
        try identity.ownerOf{gas: IDENTITY_CALL_GAS}(agentId) returns (address owner) {
            if (owner == trader) return true;
        } catch {}
        try identity.getAgentWallet{gas: IDENTITY_CALL_GAS}(agentId) returns (address wallet) {
            return wallet == trader;
        } catch {
            return false;
        }
    }

    // ------------------------------------------------------------------ unused callbacks

    /// @dev Only reached when someone other than this hook initializes a pool that names it.
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert OnlyThisHookCreatesPools();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
