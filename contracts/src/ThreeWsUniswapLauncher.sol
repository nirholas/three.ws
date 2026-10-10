// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedSupplyToken} from "./FixedSupplyToken.sol";

/// @notice Minimal Uniswap V3 NonfungiblePositionManager surface used by the launcher.
interface INonfungiblePositionManager is IERC721 {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function factory() external view returns (address);

    function WETH9() external view returns (address);
}

/// @notice Minimal Uniswap V3 factory surface.
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @notice Minimal Uniswap V3 pool surface.
interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function liquidity() external view returns (uint128);
}

/// @dev Port of Uniswap V3 TickMath.getSqrtRatioAtTick (GPL-free MIT-licensed v4-core variant of the
///      same algorithm) for Solidity 0.8. Returns sqrt(1.0001^tick) * 2^96.
library TickMath {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    error TickOutOfRange();

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            int256 t = int256(tick);
            uint256 absTick = uint256(t < 0 ? -t : t);
            if (absTick > uint256(int256(MAX_TICK))) revert TickOutOfRange();

            uint256 price = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
            if (absTick & 0x2 != 0) price = (price * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) price = (price * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) price = (price * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) price = (price * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) price = (price * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) price = (price * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) price = (price * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) price = (price * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) price = (price * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) price = (price * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) price = (price * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) price = (price * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) price = (price * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) price = (price * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) price = (price * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) price = (price * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) price = (price * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) price = (price * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) price = (price * 0x48a170391f7dc42444e8fa2) >> 128;

            if (t > 0) price = type(uint256).max / price;

            // Q128.128 -> Q128.96, rounding up.
            sqrtPriceX96 = uint160((price + 0xFFFFFFFF) >> 32);
        }
    }
}

/// @title ThreeWsUniswapLauncher
/// @notice One-transaction launcher on Base: deploys a fixed-supply ERC-20, pairs it with WETH in a
///         Uniswap V3 pool, deposits the ENTIRE supply as single-sided liquidity in one position, and
///         either hands that position NFT to the creator or locks it here (timelock or permanent) while
///         routing trading fees to a recipient with an optional platform share.
/// @dev    startTick interpretation: `startTick` is the tick of the TOKEN priced in WETH, i.e.
///         price(WETH per token) = 1.0001^startTick, regardless of address ordering. When the token
///         sorts as token0 the pool is initialised at startTick and the position spans
///         [startTick, maxUsableTick]. When the token sorts as token1 the pool tick is -startTick and the
///         position spans [minUsableTick, -startTick]. In both cases the position holds only the token,
///         so buyers pay WETH into it as price rises. startTick must be a multiple of the fee tier's
///         tickSpacing and satisfy -maxUsableTick <= startTick < maxUsableTick.
contract ThreeWsUniswapLauncher is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Whole-token supply minted for every launch (18 decimals applied by the token).
    uint256 public constant SUPPLY_WHOLE = 1_000_000_000;
    /// @notice Total supply in base units.
    uint256 public constant SUPPLY = SUPPLY_WHOLE * 1e18;
    /// @notice Maximum platform share of collected fees, in basis points.
    uint16 public constant MAX_PLATFORM_SHARE_BPS = 2000;
    uint256 public constant MIN_LOCK = 1 days;
    uint256 public constant MAX_LOCK = 3650 days;

    uint8 public constant LOCK_NONE = 0;
    uint8 public constant LOCK_TIMELOCK = 1;
    uint8 public constant LOCK_PERMANENT = 2;

    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Factory public immutable v3Factory;
    address public immutable weth;
    address public immutable treasury;
    uint256 public immutable launchFeeWei;
    uint16 public immutable platformShareBps;

    struct LaunchParams {
        string name;
        string symbol;
        uint24 fee;
        int24 startTick;
        address creator;
        address feeRecipient;
        uint8 lockMode;
        uint64 unlockAt;
        bytes32 metadataHash;
        string metadataURI;
        uint256 deadline;
    }

    struct LockedPosition {
        address creator;
        address feeRecipient;
        uint8 lockMode;
        uint64 unlockAt;
    }

    mapping(uint256 tokenId => LockedPosition) private _positions;
    bool private _launching;

    error ZeroAddress();
    error PlatformShareTooHigh();
    error TreasuryRequiredForFees();
    error DeadlinePassed();
    error InvalidFeeTier();
    error InvalidLockMode();
    error InvalidStartTick();
    error InvalidUnlockAt();
    error FeeRecipientRequired();
    error WrongLaunchFee();
    error PoolPriceMoved();
    error UnknownPosition();
    error NotCreator();
    error NotWithdrawable();
    error StillLocked();
    error UnexpectedNFT();
    error TransferFailed();

    event Launched(
        address indexed token,
        address indexed pool,
        uint256 indexed tokenId,
        address creator,
        address feeRecipient,
        uint24 fee,
        uint8 lockMode,
        uint64 unlockAt,
        int24 startTick,
        bytes32 metadataHash,
        string metadataURI
    );
    event FeesCollected(
        uint256 indexed tokenId,
        address indexed feeRecipient,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 platform0,
        uint256 platform1
    );
    event FeeRecipientUpdated(uint256 indexed tokenId, address indexed oldRecipient, address indexed newRecipient);
    event Withdrawn(uint256 indexed tokenId, address indexed creator);

    /// @param positionManager_ Uniswap V3 NonfungiblePositionManager.
    /// @param weth_ Wrapped native token the pools pair against.
    /// @param treasury_ Receives the launch fee and the platform fee share (zero disables both).
    /// @param launchFeeWei_ Exact native amount each launch must send.
    /// @param platformShareBps_ Share of collected fees sent to the treasury, at most 2000.
    constructor(
        address positionManager_,
        address weth_,
        address treasury_,
        uint256 launchFeeWei_,
        uint16 platformShareBps_
    ) {
        if (positionManager_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        if (platformShareBps_ > MAX_PLATFORM_SHARE_BPS) revert PlatformShareTooHigh();
        if (treasury_ == address(0) && (launchFeeWei_ != 0 || platformShareBps_ != 0)) {
            revert TreasuryRequiredForFees();
        }
        positionManager = INonfungiblePositionManager(positionManager_);
        v3Factory = IUniswapV3Factory(INonfungiblePositionManager(positionManager_).factory());
        weth = weth_;
        treasury = treasury_;
        launchFeeWei = launchFeeWei_;
        platformShareBps = platformShareBps_;
    }

    /// @notice Deploy a token and seed a single-sided Uniswap V3 position with its whole supply.
    /// @param p Launch parameters. See the contract NatSpec for how `startTick` is interpreted.
    /// @return token The new ERC-20.
    /// @return pool The WETH/token V3 pool.
    /// @return tokenId The liquidity position NFT id.
    function launch(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool, uint256 tokenId)
    {
        int24 spacing = _validate(p);
        if (msg.value != launchFeeWei) revert WrongLaunchFee();

        token = address(new FixedSupplyToken(p.name, p.symbol, SUPPLY_WHOLE, address(this)));
        _launching = true;
        (pool, tokenId) = _seed(token, p, spacing);
        _launching = false;

        // Rounding dust from single-sided liquidity math goes to the creator so the launcher never holds tokens.
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust != 0) IERC20(token).safeTransfer(p.creator, dust);

        if (msg.value != 0) {
            (bool ok,) = treasury.call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }

        _register(token, pool, tokenId, p);
    }

    /// @notice Collect accrued trading fees of a locked position and distribute them. Callable by anyone.
    /// @dev The treasury receives `platformShareBps` of each token, the position's fee recipient the rest.
    /// @param tokenId Locked position id.
    /// @return amount0 Total token0 collected.
    /// @return amount1 Total token1 collected.
    function collectFees(uint256 tokenId) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        LockedPosition memory pos = _positions[tokenId];
        if (pos.creator == address(0)) revert UnknownPosition();

        (amount0, amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (,, address token0, address token1,,,,,,,,) = positionManager.positions(tokenId);
        uint256 platform0 = _distribute(token0, amount0, pos.feeRecipient);
        uint256 platform1 = _distribute(token1, amount1, pos.feeRecipient);
        emit FeesCollected(tokenId, pos.feeRecipient, token0, token1, amount0, amount1, platform0, platform1);
    }

    /// @notice Re-route fees of a locked position. Works in every lock mode, including permanent.
    /// @param tokenId Locked position id.
    /// @param newRecipient New fee recipient, must be non-zero.
    function setFeeRecipient(uint256 tokenId, address newRecipient) external {
        LockedPosition storage pos = _positions[tokenId];
        if (pos.creator == address(0)) revert UnknownPosition();
        if (msg.sender != pos.creator) revert NotCreator();
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(tokenId, pos.feeRecipient, newRecipient);
        pos.feeRecipient = newRecipient;
    }

    /// @notice Release a timelocked position NFT to its creator once the lock has expired.
    /// @dev Permanent positions have no withdrawal path. Pending fees should be collected first;
    ///      after withdrawal the creator owns the NFT outright and the lock record is deleted.
    /// @param tokenId Locked position id.
    function withdraw(uint256 tokenId) external nonReentrant {
        LockedPosition memory pos = _positions[tokenId];
        if (pos.creator == address(0)) revert UnknownPosition();
        if (msg.sender != pos.creator) revert NotCreator();
        if (pos.lockMode != LOCK_TIMELOCK) revert NotWithdrawable();
        if (block.timestamp < pos.unlockAt) revert StillLocked();
        delete _positions[tokenId];
        positionManager.transferFrom(address(this), pos.creator, tokenId);
        emit Withdrawn(tokenId, pos.creator);
    }

    /// @notice Lock record of a position held by this contract.
    /// @param tokenId Position id.
    /// @return creator Address allowed to reroute fees and (timelock only) withdraw.
    /// @return feeRecipient Current fee recipient.
    /// @return lockMode 1 timelock, 2 permanent.
    /// @return unlockAt Unlock timestamp (timelock only, otherwise 0).
    function positionInfo(uint256 tokenId)
        external
        view
        returns (address creator, address feeRecipient, uint8 lockMode, uint64 unlockAt)
    {
        LockedPosition memory pos = _positions[tokenId];
        return (pos.creator, pos.feeRecipient, pos.lockMode, pos.unlockAt);
    }

    /// @notice Only accepts the position manager's own mint while a launch is in progress.
    function onERC721Received(address operator, address, uint256, bytes calldata) external view returns (bytes4) {
        if (!_launching || msg.sender != address(positionManager) || operator != address(this)) revert UnexpectedNFT();
        return IERC721Receiver.onERC721Received.selector;
    }

    function _register(address token, address pool, uint256 tokenId, LaunchParams calldata p) private {
        uint64 unlockAt = p.lockMode == LOCK_TIMELOCK ? p.unlockAt : 0;
        address recipient = p.lockMode == LOCK_NONE ? p.creator : p.feeRecipient;
        if (p.lockMode != LOCK_NONE) {
            _positions[tokenId] =
                LockedPosition({creator: p.creator, feeRecipient: recipient, lockMode: p.lockMode, unlockAt: unlockAt});
        }
        _emitLaunched(token, pool, tokenId, recipient, unlockAt, p);
    }

    function _emitLaunched(
        address token,
        address pool,
        uint256 tokenId,
        address recipient,
        uint64 unlockAt,
        LaunchParams calldata p
    ) private {
        emit Launched(
            token,
            pool,
            tokenId,
            p.creator,
            recipient,
            p.fee,
            p.lockMode,
            unlockAt,
            p.startTick,
            p.metadataHash,
            p.metadataURI
        );
    }

    function _validate(LaunchParams calldata p) private view returns (int24 spacing) {
        if (block.timestamp > p.deadline) revert DeadlinePassed();
        spacing = _tickSpacing(p.fee);
        if (p.creator == address(0)) revert ZeroAddress();
        if (p.lockMode > LOCK_PERMANENT) revert InvalidLockMode();

        int24 maxUsable = (TickMath.MAX_TICK / spacing) * spacing;
        if (p.startTick % spacing != 0 || p.startTick < -maxUsable || p.startTick >= maxUsable) {
            revert InvalidStartTick();
        }

        if (p.lockMode != LOCK_NONE && p.feeRecipient == address(0)) revert FeeRecipientRequired();
        if (p.lockMode == LOCK_TIMELOCK) {
            if (p.unlockAt < block.timestamp + MIN_LOCK || p.unlockAt > block.timestamp + MAX_LOCK) {
                revert InvalidUnlockAt();
            }
        }
    }

    function _tickSpacing(uint24 fee) private pure returns (int24) {
        if (fee == 100) return 1;
        if (fee == 500) return 10;
        if (fee == 3000) return 60;
        if (fee == 10000) return 200;
        revert InvalidFeeTier();
    }

    function _seed(address token, LaunchParams calldata p, int24 spacing)
        private
        returns (address pool, uint256 tokenId)
    {
        bool tokenIsToken0 = token < weth;
        int24 poolTick = tokenIsToken0 ? p.startTick : -p.startTick;
        uint160 sqrtPrice = TickMath.getSqrtRatioAtTick(poolTick);
        (address token0, address token1) = tokenIsToken0 ? (token, weth) : (weth, token);

        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, p.fee, sqrtPrice);
        (uint160 currentPrice,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (currentPrice != sqrtPrice) revert PoolPriceMoved();

        int24 maxUsable = (TickMath.MAX_TICK / spacing) * spacing;
        IERC20(token).forceApprove(address(positionManager), SUPPLY);
        (tokenId,,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: p.fee,
                tickLower: tokenIsToken0 ? poolTick : -maxUsable,
                tickUpper: tokenIsToken0 ? maxUsable : poolTick,
                amount0Desired: tokenIsToken0 ? SUPPLY : 0,
                amount1Desired: tokenIsToken0 ? 0 : SUPPLY,
                amount0Min: 0,
                amount1Min: 0,
                recipient: p.lockMode == LOCK_NONE ? p.creator : address(this),
                deadline: p.deadline
            })
        );
        IERC20(token).forceApprove(address(positionManager), 0);
    }

    function _distribute(address token, uint256 amount, address feeRecipient) private returns (uint256 platform) {
        if (amount == 0) return 0;
        platform = (amount * platformShareBps) / 10_000;
        if (platform != 0) IERC20(token).safeTransfer(treasury, platform);
        IERC20(token).safeTransfer(feeRecipient, amount - platform);
    }
}
