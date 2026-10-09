// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PairedToken} from "./PairedToken.sol";
import {IERC20, SafeTransfer} from "./IERC20.sol";

/// @title PairedLaunchpad
/// @notice Launch a fixed-supply coin priced against one or more tokenized
/// stocks, and trade it on a self-contained bonding curve per pairing.
///
/// @dev Design notes, because the choices here are the product:
///
/// One curve per pairing. A coin paired with NVDA and TSLA gets two
/// independent curves. They do not arbitrage each other and they are not a
/// basket: the allocation only decides how the fixed supply is divided between
/// them. Each curve is a constant-product market with a virtual quote reserve,
/// which is what lets a launch cost nothing but the flat fee. There is no
/// quote-side liquidity to provide, so a creator never needs to hold the stock
/// token to launch against it.
///
/// No migration and no ceiling. Tokens are sold from the curve asymptotically,
/// so price rises without bound and there is no graduation event at which
/// liquidity moves somewhere else and something can break. A curve that works
/// on day one works the same way on day one thousand.
///
/// No external dependencies. No AMM, no router, no oracle, no upgradeable
/// proxy. The contract someone reads is the contract that runs.
contract PairedLaunchpad {
	using SafeTransfer for IERC20;

	// ── constants ────────────────────────────────────────────────────────────

	uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
	uint16 public constant BPS = 10_000;
	uint8 public constant MAX_MARKETS = 5;
	/// @notice Creator's cut of swap fees, in bps of the fee.
	uint16 public constant CREATOR_FEE_SHARE_BPS = 7_000;

	// ── types ────────────────────────────────────────────────────────────────

	struct Allocation {
		address quoteToken;
		uint16 weightBps;
	}

	struct LaunchParams {
		string name;
		string symbol;
		string metadataURI;
		bytes32 metadataHash;
		Allocation[] allocations;
		address creatorFeeRecipient;
		/// @notice Index into `allocations` for an optional launch buy, or
		/// NO_DEV_BUY. Unlike a zero-amount buy against index 0, this cannot be
		/// confused with a real request.
		uint8 devBuyMarket;
		uint256 devBuyQuoteIn;
		uint256 devBuyMinTokensOut;
		uint256 deadline;
	}

	uint8 public constant NO_DEV_BUY = type(uint8).max;

	struct Curve {
		/// @dev Priced entirely in quote-token units. `virtualQuote` never
		/// leaves the contract; it exists so the curve has a starting price
		/// without anyone depositing the quote asset.
		uint256 virtualQuote;
		uint256 virtualToken;
		uint256 realQuote;
		uint256 tokensLeft;
		uint16 weightBps;
		bool exists;
	}

	struct QuoteConfig {
		/// @notice Starting virtual quote reserve for a full-weight pool.
		/// Set per stock so a $100 share and a $500 share start a launch at a
		/// comparable valuation rather than one being 5x the other by accident.
		uint128 virtualQuote;
		bool enabled;
	}

	// ── storage ──────────────────────────────────────────────────────────────

	address public owner;
	address public treasury;
	uint256 public launchFeeWei;
	/// @notice Swap fee in bps, taken from the quote side of every trade.
	uint16 public swapFeeBps;

	mapping(address quoteToken => QuoteConfig) public quoteConfig;
	address[] private _quoteList;

	mapping(address token => address[] quoteTokens) private _markets;
	mapping(address token => mapping(address quoteToken => Curve)) private _curves;
	mapping(address token => address) public creatorOf;
	mapping(address token => address) public feeRecipientOf;

	/// @notice Fees waiting to be claimed, by recipient and quote asset.
	mapping(address recipient => mapping(address quoteToken => uint256)) public claimable;

	address[] private _allTokens;

	bool private _entered;

	// ── events ───────────────────────────────────────────────────────────────

	event Launched(
		address indexed token,
		address indexed creator,
		string name,
		string symbol,
		string metadataURI,
		Allocation[] allocations
	);
	event Swap(
		address indexed token,
		address indexed quoteToken,
		address indexed trader,
		bool isBuy,
		uint256 quoteAmount,
		uint256 tokenAmount,
		uint256 feeAmount
	);
	event FeesAccrued(address indexed recipient, address indexed quoteToken, uint256 amount);
	event FeesClaimed(address indexed recipient, address indexed quoteToken, uint256 amount);
	event FeeRecipientChanged(address indexed token, address indexed from, address indexed to);
	event QuoteConfigured(address indexed quoteToken, uint128 virtualQuote, bool enabled);
	event ParamsChanged(uint256 launchFeeWei, uint16 swapFeeBps, address treasury);
	event OwnerChanged(address indexed from, address indexed to);

	// ── errors ───────────────────────────────────────────────────────────────

	error NotOwner();
	error Reentrancy();
	error Expired();
	error BadFee();
	error NoMarkets();
	error TooManyMarkets();
	error WeightsMustTotalBps();
	error DuplicateMarket();
	error QuoteNotEnabled();
	error UnknownMarket();
	error ZeroAmount();
	error SlippageExceeded();
	error NothingToClaim();
	error BadDevBuy();
	error NameOrSymbolEmpty();
	error NotFeeRecipient();
	error FeeTooHigh();

	modifier onlyOwner() {
		if (msg.sender != owner) revert NotOwner();
		_;
	}

	/// @dev Quote assets are third-party contracts. Every path that moves them
	/// is guarded rather than relying on any one token being well behaved.
	modifier nonReentrant() {
		if (_entered) revert Reentrancy();
		_entered = true;
		_;
		_entered = false;
	}

	constructor(address _treasury, uint256 _launchFeeWei, uint16 _swapFeeBps) {
		if (_swapFeeBps > 500) revert FeeTooHigh();
		owner = msg.sender;
		treasury = _treasury;
		launchFeeWei = _launchFeeWei;
		swapFeeBps = _swapFeeBps;
		emit OwnerChanged(address(0), msg.sender);
		emit ParamsChanged(_launchFeeWei, _swapFeeBps, _treasury);
	}

	// ── launching ────────────────────────────────────────────────────────────

	/// @notice Deploy a coin and open its curves.
	/// @dev The launch fee is the only mandatory cost. A dev buy is optional
	/// and, when requested, pulls the quote asset from the caller, so it needs
	/// a prior approval; skipping it needs nothing.
	function launch(LaunchParams calldata p)
		external
		payable
		nonReentrant
		returns (address token)
	{
		if (block.timestamp > p.deadline) revert Expired();
		if (msg.value != launchFeeWei) revert BadFee();
		if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert NameOrSymbolEmpty();

		uint256 n = p.allocations.length;
		if (n == 0) revert NoMarkets();
		if (n > MAX_MARKETS) revert TooManyMarkets();

		uint256 weightTotal;
		for (uint256 i; i < n; ++i) {
			Allocation calldata a = p.allocations[i];
			if (!quoteConfig[a.quoteToken].enabled) revert QuoteNotEnabled();
			for (uint256 j; j < i; ++j) {
				if (p.allocations[j].quoteToken == a.quoteToken) revert DuplicateMarket();
			}
			weightTotal += a.weightBps;
		}
		if (weightTotal != BPS) revert WeightsMustTotalBps();

		token = address(
			new PairedToken(p.name, p.symbol, TOTAL_SUPPLY, p.metadataURI, p.metadataHash, address(this))
		);

		creatorOf[token] = msg.sender;
		feeRecipientOf[token] = p.creatorFeeRecipient == address(0) ? msg.sender : p.creatorFeeRecipient;
		_allTokens.push(token);

		uint256 assigned;
		for (uint256 i; i < n; ++i) {
			Allocation calldata a = p.allocations[i];
			// The last market absorbs the integer-division dust so the sum of
			// the pools is exactly the supply, never one wei short.
			uint256 amount = i == n - 1
				? TOTAL_SUPPLY - assigned
				: (TOTAL_SUPPLY * a.weightBps) / BPS;
			assigned += amount;

			uint256 vq = (uint256(quoteConfig[a.quoteToken].virtualQuote) * a.weightBps) / BPS;
			_curves[token][a.quoteToken] = Curve({
				virtualQuote: vq,
				virtualToken: amount,
				realQuote: 0,
				tokensLeft: amount,
				weightBps: a.weightBps,
				exists: true
			});
			_markets[token].push(a.quoteToken);
		}

		emit Launched(token, msg.sender, p.name, p.symbol, p.metadataURI, p.allocations);

		if (p.devBuyMarket != NO_DEV_BUY) {
			if (p.devBuyMarket >= n || p.devBuyQuoteIn == 0) revert BadDevBuy();
			_buy(
				token,
				p.allocations[p.devBuyMarket].quoteToken,
				p.devBuyQuoteIn,
				p.devBuyMinTokensOut,
				msg.sender
			);
		}

		if (msg.value != 0) {
			(bool sent, ) = treasury.call{value: msg.value}("");
			if (!sent) revert TransferToTreasuryFailed();
		}
	}

	error TransferToTreasuryFailed();

	// ── trading ──────────────────────────────────────────────────────────────

	/// @notice Spend `quoteIn` of the paired stock to buy the coin.
	function buy(
		address token,
		address quoteToken,
		uint256 quoteIn,
		uint256 minTokensOut
	) external nonReentrant returns (uint256 tokensOut) {
		return _buy(token, quoteToken, quoteIn, minTokensOut, msg.sender);
	}

	/// @notice Sell the coin back into a curve for the paired stock.
	function sell(
		address token,
		address quoteToken,
		uint256 tokensIn,
		uint256 minQuoteOut
	) external nonReentrant returns (uint256 quoteOut) {
		Curve storage c = _curves[token][quoteToken];
		if (!c.exists) revert UnknownMarket();
		if (tokensIn == 0) revert ZeroAmount();

		IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);

		uint256 grossQuote = _quoteOut(c, tokensIn);
		uint256 fee = (grossQuote * swapFeeBps) / BPS;
		quoteOut = grossQuote - fee;
		if (quoteOut < minQuoteOut) revert SlippageExceeded();

		c.virtualToken += tokensIn;
		c.tokensLeft += tokensIn;
		c.virtualQuote -= grossQuote;
		c.realQuote -= grossQuote;

		_accrue(token, quoteToken, fee);
		IERC20(quoteToken).safeTransfer(msg.sender, quoteOut);

		emit Swap(token, quoteToken, msg.sender, false, quoteOut, tokensIn, fee);
	}

	function _buy(
		address token,
		address quoteToken,
		uint256 quoteIn,
		uint256 minTokensOut,
		address buyer
	) private returns (uint256 tokensOut) {
		Curve storage c = _curves[token][quoteToken];
		if (!c.exists) revert UnknownMarket();
		if (quoteIn == 0) revert ZeroAmount();

		IERC20(quoteToken).safeTransferFrom(buyer, address(this), quoteIn);

		uint256 fee = (quoteIn * swapFeeBps) / BPS;
		uint256 netIn = quoteIn - fee;

		tokensOut = _tokensOut(c, netIn);
		if (tokensOut < minTokensOut) revert SlippageExceeded();
		if (tokensOut > c.tokensLeft) revert ZeroAmount();

		c.virtualQuote += netIn;
		c.realQuote += netIn;
		c.virtualToken -= tokensOut;
		c.tokensLeft -= tokensOut;

		_accrue(token, quoteToken, fee);
		IERC20(token).safeTransfer(buyer, tokensOut);

		emit Swap(token, quoteToken, buyer, true, quoteIn, tokensOut, fee);
	}

	/// @dev Constant product against the virtual reserves. Tokens out
	/// approaches, but never reaches, the reserve, so the curve has no final
	/// token and therefore no price ceiling.
	///
	/// Both sides round the remaining reserve UP, which rounds the amount out
	/// DOWN. Rounding the other way lets a buy-then-sell round trip return one
	/// wei more than it put in, and repeating that drains the pool a wei at a
	/// time. Dust in the pool's favour is the only safe direction.
	function _tokensOut(Curve storage c, uint256 netIn) private view returns (uint256) {
		uint256 k = c.virtualQuote * c.virtualToken;
		uint256 newQuote = c.virtualQuote + netIn;
		return c.virtualToken - _ceilDiv(k, newQuote);
	}

	function _quoteOut(Curve storage c, uint256 tokensIn) private view returns (uint256) {
		uint256 k = c.virtualQuote * c.virtualToken;
		uint256 newToken = c.virtualToken + tokensIn;
		return c.virtualQuote - _ceilDiv(k, newToken);
	}

	function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
		return a == 0 ? 0 : ((a - 1) / b) + 1;
	}

	function _accrue(address token, address quoteToken, uint256 fee) private {
		if (fee == 0) return;
		uint256 creatorCut = (fee * CREATOR_FEE_SHARE_BPS) / BPS;
		address recipient = feeRecipientOf[token];
		claimable[recipient][quoteToken] += creatorCut;
		claimable[treasury][quoteToken] += fee - creatorCut;
		emit FeesAccrued(recipient, quoteToken, creatorCut);
	}

	// ── fees ─────────────────────────────────────────────────────────────────

	/// @notice Claim every listed asset in one transaction.
	/// @dev Batched on purpose. A creator paired against three stocks earns in
	/// three assets, and making them send three transactions to collect one
	/// day of fees is how fees go unclaimed.
	function claimFees(address[] calldata assets) external nonReentrant returns (uint256 claimedCount) {
		for (uint256 i; i < assets.length; ++i) {
			address q = assets[i];
			uint256 amount = claimable[msg.sender][q];
			if (amount == 0) continue;
			claimable[msg.sender][q] = 0;
			IERC20(q).safeTransfer(msg.sender, amount);
			emit FeesClaimed(msg.sender, q, amount);
			unchecked {
				++claimedCount;
			}
		}
		if (claimedCount == 0) revert NothingToClaim();
	}

	/// @notice Point a coin's future fees at a different address.
	/// @dev PAIR fixes this at launch. Letting the current recipient move it
	/// means a creator who rotates wallets, or hands a project to a DAO, does
	/// not lose the revenue stream. Already-accrued fees stay with whoever
	/// earned them.
	function setFeeRecipient(address token, address to) external {
		address current = feeRecipientOf[token];
		if (msg.sender != current) revert NotFeeRecipient();
		feeRecipientOf[token] = to;
		emit FeeRecipientChanged(token, current, to);
	}

	// ── views ────────────────────────────────────────────────────────────────

	function marketsOf(address token) external view returns (address[] memory) {
		return _markets[token];
	}

	function curveOf(address token, address quoteToken) external view returns (Curve memory) {
		return _curves[token][quoteToken];
	}

	function tokenCount() external view returns (uint256) {
		return _allTokens.length;
	}

	function tokenAt(uint256 index) external view returns (address) {
		return _allTokens[index];
	}

	function quoteTokens() external view returns (address[] memory) {
		return _quoteList;
	}

	/// @notice Price of one whole coin in quote-token units, scaled by 1e18.
	function priceOf(address token, address quoteToken) external view returns (uint256) {
		Curve storage c = _curves[token][quoteToken];
		if (!c.exists || c.virtualToken == 0) return 0;
		return (c.virtualQuote * 1e18) / c.virtualToken;
	}

	function quoteBuy(address token, address quoteToken, uint256 quoteIn)
		external
		view
		returns (uint256 tokensOut, uint256 fee)
	{
		Curve storage c = _curves[token][quoteToken];
		if (!c.exists || quoteIn == 0) return (0, 0);
		fee = (quoteIn * swapFeeBps) / BPS;
		tokensOut = _tokensOut(c, quoteIn - fee);
	}

	function quoteSell(address token, address quoteToken, uint256 tokensIn)
		external
		view
		returns (uint256 quoteOut, uint256 fee)
	{
		Curve storage c = _curves[token][quoteToken];
		if (!c.exists || tokensIn == 0) return (0, 0);
		uint256 gross = _quoteOut(c, tokensIn);
		fee = (gross * swapFeeBps) / BPS;
		quoteOut = gross - fee;
	}

	// ── administration ───────────────────────────────────────────────────────

	function setQuoteConfig(address quoteToken, uint128 virtualQuote, bool enabled) external onlyOwner {
		if (quoteConfig[quoteToken].virtualQuote == 0 && virtualQuote != 0) _quoteList.push(quoteToken);
		quoteConfig[quoteToken] = QuoteConfig({virtualQuote: virtualQuote, enabled: enabled});
		emit QuoteConfigured(quoteToken, virtualQuote, enabled);
	}

	function setParams(uint256 _launchFeeWei, uint16 _swapFeeBps, address _treasury) external onlyOwner {
		// Capped in code, not just in policy: an owner key that can raise the
		// swap fee without limit is an owner key that can expropriate traders.
		if (_swapFeeBps > 500) revert FeeTooHigh();
		launchFeeWei = _launchFeeWei;
		swapFeeBps = _swapFeeBps;
		treasury = _treasury;
		emit ParamsChanged(_launchFeeWei, _swapFeeBps, _treasury);
	}

	function transferOwnership(address to) external onlyOwner {
		emit OwnerChanged(owner, to);
		owner = to;
	}
}
