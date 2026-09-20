// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {SkinToken} from "./SkinToken.sol";

/// @title SkinHook
/// @notice Wearable 3D items as coins. Every item is a fixed-supply ERC-20 with its own
///         ETH pool, launched through this one hook. To wear an item you lock one whole
///         token here and get it back when you take it off, so every wearer removes a token
///         from the float. The creator's royalty is taken inside the swap, in ETH, and
///         cannot be routed around. A swap may name a referrer (the site whose embed sold
///         it) in `hookData`, and that referrer is paid a share of the fee.
/// @dev Singleton. The hook is its own factory: it deploys the token, initializes the pool
///      and seeds the whole supply as one permanent single-sided position. v4 skips hook
///      callbacks for calls the hook makes itself, so `beforeInitialize` only ever runs for
///      an outsider and always reverts: every pool that names this hook was launched here.
///      Fees are held as ERC-6909 claims on the PoolManager and paid out on `claim`, so a
///      swap never pushes ETH to anyone and cannot be blocked by a reverting recipient.
contract SkinHook is IHooks, IUnlockCallback, Ownable2Step {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;

    // ------------------------------------------------------------------ constants

    /// @notice Total fee on the ETH side of every swap, in basis points.
    uint256 public constant FEE_BPS = 200;
    /// @notice Creator's share of the fee, in basis points of the fee.
    uint256 public constant CREATOR_SHARE_BPS = 5000;
    /// @notice Referrer's share of the fee. Paid to the creator when no referrer is named.
    uint256 public constant REFERRER_SHARE_BPS = 2500;
    uint256 internal constant BPS = 10_000;

    /// @notice Locking exactly one whole token is what wearing costs.
    uint256 public constant EQUIP_AMOUNT = 1e18;
    uint256 public constant MIN_SUPPLY = 100;
    uint256 public constant MAX_SUPPLY = 1_000_000;

    int24 public constant TICK_SPACING = 200;
    /// @dev Pool price is tokens per ETH. 46000 is about 100 tokens per ETH (0.01 ETH each),
    ///      161200 is about 10 million tokens per ETH. A launch starts cheap and climbs.
    int24 public constant MIN_START_TICK = 46_000;
    int24 public constant MAX_START_TICK = 161_200;
    int24 internal constant RANGE_LOWER_TICK = -887_200;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ------------------------------------------------------------------ storage

    IPoolManager public immutable poolManager;

    struct Skin {
        SkinToken token;
        address creator;
    }

    mapping(PoolId => Skin) public skins;
    mapping(SkinToken => bool) public isSkin;
    mapping(SkinToken => mapping(address => bool)) public isWearing;
    mapping(SkinToken => uint256) public wearerCount;

    /// @notice ETH owed to creators, referrers and the treasury, withdrawn with `claim`.
    mapping(address => uint256) public owed;
    address public treasury;

    struct LaunchParams {
        string name;
        string symbol;
        uint256 supply; // whole tokens
        string modelURI;
        bytes32 modelHash;
        string slot;
        int24 startTick;
        address creator;
    }

    enum Action {
        Seed,
        Claim
    }

    // ------------------------------------------------------------------ events and errors

    event SkinLaunched(
        SkinToken indexed token,
        PoolId indexed poolId,
        address indexed creator,
        uint256 supply,
        int24 startTick,
        bytes32 modelHash,
        string modelURI,
        string slot
    );
    event Equipped(SkinToken indexed token, address indexed wearer, uint256 wearers);
    event Unequipped(SkinToken indexed token, address indexed wearer, uint256 wearers);
    event FeeAccrued(
        PoolId indexed poolId, address indexed referrer, uint256 creatorCut, uint256 referrerCut, uint256 treasuryCut
    );
    event Claimed(address indexed account, address indexed to, uint256 amount);
    event TreasuryChanged(address indexed previous, address indexed current);

    error NotPoolManager();
    error OnlyThisHookLaunchesPools();
    error HookNotImplemented();
    error InvalidSupply();
    error InvalidStartTick();
    error InvalidModel();
    error ZeroAddress();
    error NotASkin();
    error AlreadyWearing();
    error NotWearing();
    error NothingToClaim();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager poolManager_, address owner_, address treasury_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        poolManager = poolManager_;
        treasury = treasury_;
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
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ------------------------------------------------------------------ launch

    /// @notice Launch a wearable: deploy its token, open its ETH pool and seed the entire
    ///         supply as one permanent position that sells from `startTick` upward in price.
    ///         Nothing is held back for the creator or the platform.
    function launch(LaunchParams calldata p) external returns (SkinToken token, PoolKey memory key) {
        if (p.supply < MIN_SUPPLY || p.supply > MAX_SUPPLY) revert InvalidSupply();
        if (p.startTick < MIN_START_TICK || p.startTick > MAX_START_TICK || p.startTick % TICK_SPACING != 0) {
            revert InvalidStartTick();
        }
        if (p.modelHash == bytes32(0) || bytes(p.modelURI).length == 0) revert InvalidModel();
        if (p.creator == address(0)) revert ZeroAddress();

        uint256 supplyWei = p.supply * 1e18;
        token = new SkinToken(p.name, p.symbol, supplyWei, p.modelURI, p.modelHash, p.slot, p.creator);

        // Native ETH is address(0), so it always sorts first and the item is always currency1.
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
        PoolId poolId = key.toId();
        skins[poolId] = Skin({token: token, creator: p.creator});
        isSkin[token] = true;

        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(p.startTick));
        poolManager.unlock(abi.encode(Action.Seed, abi.encode(key, p.startTick, supplyWei)));

        // Liquidity rounds down, so a few wei of the supply can be left over. Burn them
        // so that the hook's token balance is exactly the equipped tokens and nothing else.
        uint256 dust = token.balanceOf(address(this));
        if (dust != 0) token.transfer(DEAD, dust);

        emit SkinLaunched(token, poolId, p.creator, p.supply, p.startTick, p.modelHash, p.modelURI, p.slot);
    }

    // ------------------------------------------------------------------ wear-to-lock

    /// @notice Put the item on. Locks one whole token here until `unequip`.
    function equip(SkinToken token) external {
        if (!isSkin[token]) revert NotASkin();
        if (isWearing[token][msg.sender]) revert AlreadyWearing();
        isWearing[token][msg.sender] = true;
        uint256 wearers = ++wearerCount[token];
        token.transferFrom(msg.sender, address(this), EQUIP_AMOUNT);
        emit Equipped(token, msg.sender, wearers);
    }

    /// @notice Take the item off and get the locked token back.
    function unequip(SkinToken token) external {
        if (!isWearing[token][msg.sender]) revert NotWearing();
        isWearing[token][msg.sender] = false;
        uint256 wearers = --wearerCount[token];
        token.transfer(msg.sender, EQUIP_AMOUNT);
        emit Unequipped(token, msg.sender, wearers);
    }

    // ------------------------------------------------------------------ fees

    /// @notice Withdraw everything owed to the caller, to `to`.
    function claim(address to) external returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = owed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        owed[msg.sender] = 0;
        poolManager.unlock(abi.encode(Action.Claim, abi.encode(to, amount)));
        emit Claimed(msg.sender, to, amount);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, treasury_);
        treasury = treasury_;
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));
        if (action == Action.Seed) {
            (PoolKey memory key, int24 startTick, uint256 supplyWei) = abi.decode(payload, (PoolKey, int24, uint256));
            _seed(key, startTick, supplyWei);
        } else {
            (address to, uint256 amount) = abi.decode(payload, (address, uint256));
            poolManager.burn(address(this), CurrencyLibrary.ADDRESS_ZERO.toId(), amount);
            poolManager.take(CurrencyLibrary.ADDRESS_ZERO, to, amount);
        }
        return "";
    }

    /// @dev The pool starts at the top of the range, where a position is entirely currency1,
    ///      so seeding costs only the item and no ETH.
    function _seed(PoolKey memory key, int24 startTick, uint256 supplyWei) internal {
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(startTick);
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(RANGE_LOWER_TICK);
        uint256 liquidity = FullMath.mulDiv(supplyWei, FixedPoint96.Q96, sqrtUpper - sqrtLower);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: RANGE_LOWER_TICK,
                tickUpper: startTick,
                liquidityDelta: int256(liquidity),
                salt: bytes32(0)
            }),
            ""
        );

        uint256 owedTokens = uint256(uint128(-delta.amount1()));
        poolManager.sync(key.currency1);
        SkinToken(Currency.unwrap(key.currency1)).transfer(address(poolManager), owedTokens);
        poolManager.settle();
    }

    // ------------------------------------------------------------------ swap callbacks

    /// @dev When ETH is the specified side of the swap, the fee is taken here, out of the
    ///      specified amount. Otherwise `afterSwap` takes it from the ETH that moved.
    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!_ethIsSpecified(params)) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        uint256 amount =
            params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = amount * FEE_BPS / BPS;
        _accrue(key, fee, hookData);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt128(), 0), 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        if (_ethIsSpecified(params)) return (IHooks.afterSwap.selector, 0);

        int128 ethMoved = delta.amount0();
        uint256 amount = uint256(uint128(ethMoved < 0 ? -ethMoved : ethMoved));
        uint256 fee = amount * FEE_BPS / BPS;
        _accrue(key, fee, hookData);
        return (IHooks.afterSwap.selector, fee.toInt128());
    }

    /// @dev ETH is currency0. The specified currency is currency0 exactly when an exact-input
    ///      swap sells currency0, or an exact-output swap buys it.
    function _ethIsSpecified(IPoolManager.SwapParams calldata params) internal pure returns (bool) {
        return (params.amountSpecified < 0) == params.zeroForOne;
    }

    function _accrue(PoolKey calldata key, uint256 fee, bytes calldata hookData) internal {
        if (fee == 0) return;
        poolManager.mint(address(this), CurrencyLibrary.ADDRESS_ZERO.toId(), fee);

        PoolId poolId = key.toId();
        address creator = skins[poolId].creator;
        address referrer = _referrer(hookData);

        uint256 creatorCut = fee * CREATOR_SHARE_BPS / BPS;
        uint256 referrerCut = fee * REFERRER_SHARE_BPS / BPS;
        uint256 treasuryCut = fee - creatorCut - referrerCut;
        if (referrer == address(0)) {
            creatorCut += referrerCut;
            referrerCut = 0;
        } else {
            owed[referrer] += referrerCut;
        }
        owed[creator] += creatorCut;
        owed[treasury] += treasuryCut;
        emit FeeAccrued(poolId, referrer, creatorCut, referrerCut, treasuryCut);
    }

    /// @dev `hookData` is optional. Exactly 32 bytes holding a clean address names a referrer;
    ///      anything else is ignored, so malformed data can never make a swap revert.
    function _referrer(bytes calldata hookData) internal pure returns (address) {
        if (hookData.length != 32) return address(0);
        uint256 raw = uint256(bytes32(hookData[:32]));
        if (raw >> 160 != 0) return address(0);
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(raw)); // safe: the upper 96 bits were just checked to be zero

    }

    // ------------------------------------------------------------------ unused callbacks

    /// @dev Only reached when someone other than this hook initializes a pool that names it.
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert OnlyThisHookLaunchesPools();
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

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
