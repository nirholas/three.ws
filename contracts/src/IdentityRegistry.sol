// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ERC-8004 Identity Registry
/// @notice Agents are minted as ERC-721 tokens with a `tokenURI` pointing to an
///         ERC-8004 registration JSON. Each agent can optionally delegate a
///         separate wallet address and store arbitrary key/value metadata.
contract IdentityRegistry is ERC721Enumerable, EIP712, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 private _nextId;

    mapping(uint256 => string) private _agentURI;
    mapping(uint256 => address) private _agentWallet;
    mapping(uint256 => mapping(string => bytes)) private _metadata;
    mapping(address => uint256) public nonces;

    // Max spend per on-chain agent ID per authorized spender (set by agent NFT owner)
    mapping(uint256 => mapping(address => uint256)) public spendAllowance;

    // EIP-712 typehash for delegated wallet binding.
    bytes32 private constant _SET_WALLET_TYPEHASH = keccak256(
        "SetAgentWallet(uint256 agentId,address newWallet,uint256 nonce,uint256 deadline)"
    );

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event WalletSet(uint256 indexed agentId, address indexed wallet);
    event WalletUnset(uint256 indexed agentId);
    event SpendAllowanceSet(uint256 indexed agentId, address indexed spender, uint256 maxWei);
    event AgentPayment(
        uint256 indexed agentId,
        address indexed spender,
        address indexed recipient,
        uint256 amountWei,
        string memo
    );
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotAgentOwner();
    error SignatureExpired();
    error InvalidSignature();
    error UnknownAgent();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() ERC721("ERC-8004 Agent", "AGENT") EIP712("ERC8004-IdentityRegistry", "1") {}

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function register() external returns (uint256 agentId) {
        return _register(msg.sender, "");
    }

    function register(string calldata agentURI) external returns (uint256 agentId) {
        return _register(msg.sender, agentURI);
    }

    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external
        returns (uint256 agentId)
    {
        agentId = _register(msg.sender, agentURI);
        for (uint256 i = 0; i < metadata.length; i++) {
            _setMetadata(agentId, metadata[i].metadataKey, metadata[i].metadataValue);
        }
    }

    function _register(address to, string memory agentURI) internal returns (uint256 agentId) {
        unchecked {
            agentId = ++_nextId;
        }
        _safeMint(to, agentId);
        if (bytes(agentURI).length > 0) {
            _agentURI[agentId] = agentURI;
        }
        emit Registered(agentId, agentURI, to);
    }

    // ---------------------------------------------------------------------
    // URI
    // ---------------------------------------------------------------------

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _agentURI[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _agentURI[agentId];
    }

    // ---------------------------------------------------------------------
    // Wallet delegation
    // ---------------------------------------------------------------------

    /// @notice Bind a delegated wallet address to an agent. The signature must
    ///         be produced by the agent's NFT owner over an EIP-712 payload.
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        address owner = ownerOf(agentId);

        bytes32 structHash = keccak256(
            abi.encode(_SET_WALLET_TYPEHASH, agentId, newWallet, nonces[owner], deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) {
            revert InvalidSignature();
        }

        unchecked {
            nonces[owner]++;
        }
        _agentWallet[agentId] = newWallet;
        emit WalletSet(agentId, newWallet);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        _requireOwned(agentId);
        address w = _agentWallet[agentId];
        return w == address(0) ? ownerOf(agentId) : w;
    }

    function unsetAgentWallet(uint256 agentId) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        delete _agentWallet[agentId];
        emit WalletUnset(agentId);
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------

    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue)
        external
    {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _setMetadata(agentId, metadataKey, metadataValue);
    }

    function _setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue)
        internal
    {
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    function getMetadata(uint256 agentId, string calldata metadataKey)
        external
        view
        returns (bytes memory)
    {
        _requireOwned(agentId);
        return _metadata[agentId][metadataKey];
    }

    // ---------------------------------------------------------------------
    // Agent spend delegation
    // ---------------------------------------------------------------------

    receive() external payable {}

    /// @notice Agent NFT owner authorizes a spender (e.g. delegated server key) to
    ///         spend up to maxWei from this contract on behalf of the agent.
    function setSpendAllowance(uint256 agentId, address spender, uint256 maxWei)
        external
    {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        spendAllowance[agentId][spender] = maxWei;
        emit SpendAllowanceSet(agentId, spender, maxWei);
    }

    /// @notice Spend ETH held by this contract on behalf of an agent.
    ///         Caller must have been granted allowance via setSpendAllowance.
    function spend(
        uint256 agentId,
        address payable recipient,
        uint256 amountWei,
        string calldata memo
    ) external nonReentrant {
        require(spendAllowance[agentId][msg.sender] >= amountWei, "allowance exceeded");
        require(address(this).balance >= amountWei, "contract balance insufficient");
        spendAllowance[agentId][msg.sender] -= amountWei;
        recipient.transfer(amountWei);
        emit AgentPayment(agentId, msg.sender, recipient, amountWei, memo);
    }

    // ---------------------------------------------------------------------
    // Introspection helpers
    // ---------------------------------------------------------------------

    function isAgent(uint256 agentId) external view returns (bool) {
        return _ownerOf(agentId) != address(0);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
