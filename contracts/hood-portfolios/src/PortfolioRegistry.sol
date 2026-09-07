// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PortfolioRegistry
 * @notice The published methodology behind every Robinhood Chain portfolio: what it holds, why, who vouched
 * for it, and which portfolio it was forked from.
 *
 * @dev A Robinhood Chain portfolio is generated off-chain: a person writes a prompt, a screen ranks a
 * universe of tokens against it, and the result is a set of constituents and target weights. That
 * output is worthless as a promise. This registry is what turns it into an artifact:
 *
 *  1. The full manifest (prompt text, screen inputs, every candidate that failed and why, the
 *     constituents, the weights, the rebalance schedule) is content-addressed off-chain. Only its
 *     hash is committed here, so the chain stores 32 bytes and anyone can prove the document they
 *     were shown is the document that was committed.
 *  2. It is signed by an attester over EIP-712, so the commitment carries a name.
 *  3. It is IMMUTABLE. There is no edit path, by construction: `manifestHash` is written once in
 *     `publish` and no function assigns to it again.
 *
 * ## Why refinement mints a new version instead of mutating one
 *
 * The product this is modelled on lets a user refine an index with follow-up prompts, and the index
 * they already hold changes underneath them. On-chain that is not a feature, it is the definition of
 * a rug: the manifest is the only thing a holder relies on, and an editable manifest means the
 * constituents can become anything after the money arrives.
 *
 * So refinement publishes a NEW id whose `parent` points at the old one. Holders of the old version
 * keep exactly what they bought and are never migrated; they can redeem and re-issue into the new
 * version if they want it. The lineage pointer is what makes this cheap rather than punitive: the
 * fork is discoverable from the parent, carries its history, and pays it (see `LINEAGE_BUDGET_BPS`).
 *
 * ## What stops a manifest whose weights don't match its prompt
 *
 * Nothing on-chain can read English, so any design that claims to bind the prompt to the weights is
 * lying. Robinhood Portfolios takes the honest position and encodes it in the type system rather than in a
 * disclaimer: **the weights are binding and the prompt is provenance.** The weights are committed,
 * attested, and enforced by the vault, which will only ever hold the constituents it was deployed
 * with. The prompt is published alongside them so a reader can judge whether the screen did what it
 * said, and an attester who repeatedly signs manifests whose weights do not follow their stated
 * screen is judged by their own signature being on all of them.
 *
 * The alternatives were considered and rejected. A challenge period cannot resolve "does this basket
 * match this sentence" without an oracle for taste. Attestation staking prices a subjective dispute
 * and hands the outcome to whoever adjudicates it. A multi-attester quorum makes collusion slightly
 * harder without making the underlying question decidable. What is actually decidable is whether a
 * screen, re-run against its recorded inputs, reproduces its recorded output, and that check is
 * cheap off-chain and needs no bond: the manifest records the universe snapshot and the ranking
 * inputs, so anyone can re-run it and publish the diff.
 */
contract PortfolioRegistry is EIP712, Ownable {
    // ── Types ────────────────────────────────────────────────────────────────

    struct Manifest {
        /// @notice Hash of the content-addressed manifest document. Written once, never reassigned.
        bytes32 manifestHash;
        /// @notice Where that document lives (`ipfs://…`). Advisory: the hash is what binds.
        string uri;
        /// @notice Who published it and receives the creator fee.
        address creator;
        /// @notice The attester whose signature was checked at publication.
        address attester;
        /// @notice The id this was forked from, or 0 for a root. Ids start at 1.
        uint256 parent;
        /// @notice Depth in the lineage tree. A root is 0.
        uint32 depth;
        /// @notice Block timestamp of publication.
        uint64 publishedAt;
        /// @notice The vault deployed for this manifest, or address(0) until one is.
        address portfolio;
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    /// @notice EIP-712 type hash for an attester's signature over a manifest.
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("PortfolioAttestation(bytes32 manifestHash,address creator,uint256 parent,uint256 deadline)");

    /// @notice The share of a portfolio's fee that is reserved for its lineage, in basis points.
    /// @dev This is the whole sybil answer, and it is a budget rather than a rule. The amount paid
    /// up the tree is a FIXED fraction of the fee no matter how deep the tree is, so forking your
    /// own portfolio fifty times cannot increase what the tree pays out; it only splits the same
    /// slice into smaller pieces, and every extra hop dilutes the forker's own ancestors, including
    /// themselves. There is nothing to farm, so nothing needs to be policed.
    uint16 public constant LINEAGE_BUDGET_BPS = 2_000;

    /// @notice Each further step up the tree receives this fraction of the step below, in bps.
    /// @dev Geometric decay. With a 50% decay and a 2000bps budget, a direct parent receives 1000bps
    /// of the fee, a grandparent 500, and so on; the tail that is never reached because of
    /// `MAX_LINEAGE_DEPTH` stays with the portfolio's own creator.
    uint16 public constant LINEAGE_DECAY_BPS = 5_000;

    /// @notice How many ancestors are paid before the walk stops.
    /// @dev Bounded so `feeSplit` can never be made expensive enough to brick fee accrual by
    /// publishing a pathologically deep chain.
    uint32 public constant MAX_LINEAGE_DEPTH = 8;

    /// @notice id => manifest. Ids are sequential from 1.
    mapping(uint256 => Manifest) private _manifests;

    /// @notice Number of manifests published.
    uint256 public count;

    /// @notice Addresses whose signature `publish` accepts.
    mapping(address => bool) public isAttester;

    /// @notice Direct forks of each id, so the lineage tree can be walked downward off-chain.
    mapping(uint256 => uint256[]) private _children;

    /// @notice Prevents the same manifest hash being published twice.
    mapping(bytes32 => uint256) public idOfHash;

    /// @notice Deployers allowed to link a vault on a creator's behalf.
    /// @dev A factory needs this because it, not the creator, is `msg.sender` when it deploys the
    /// vault, and requiring a second transaction to link would leave every portfolio briefly
    /// published-but-unlinked. An approved factory is trusted only to name the address it just
    /// deployed for a manifest whose creator it already checked; it can never change a creator, and
    /// `linkPortfolio` still refuses a manifest that already has a vault, so it cannot relink one.
    mapping(address => bool) public isFactory;

    // ── Events ───────────────────────────────────────────────────────────────

    event AttesterSet(address indexed attester, bool allowed);
    event FactorySet(address indexed factory, bool allowed);
    event Published(
        uint256 indexed id,
        uint256 indexed parent,
        address indexed creator,
        bytes32 manifestHash,
        address attester,
        string uri
    );
    event PortfolioLinked(uint256 indexed id, address indexed portfolio);

    // ── Errors ───────────────────────────────────────────────────────────────

    error UnknownManifest(uint256 id);
    error DuplicateManifest(bytes32 manifestHash, uint256 existingId);
    error NotAnAttester(address signer);
    error AttestationExpired(uint256 deadline);
    error EmptyManifestHash();
    error PortfolioAlreadyLinked(uint256 id, address portfolio);
    error NotTheCreator(address caller, address creator);
    error NotCreatorOrFactory(address caller, address creator);
    error LineageTooDeep(uint32 depth);

    // ── Construction ─────────────────────────────────────────────────────────

    constructor(address owner_, address firstAttester) EIP712("RobinhoodPortfolios", "1") Ownable(owner_) {
        if (firstAttester != address(0)) {
            isAttester[firstAttester] = true;
            emit AttesterSet(firstAttester, true);
        }
    }

    // ── Governance ───────────────────────────────────────────────────────────

    /// @notice Allow or revoke an attester.
    /// @dev Revoking does not invalidate manifests already published under that key. It cannot: the
    /// vaults holding real assets were deployed against those manifests, and retroactively voiding
    /// them would strand holders. Revocation only stops NEW publications, and the historical
    /// attester stays recorded on each manifest so a reader can weigh it.
    function setAttester(address attester, bool allowed) external onlyOwner {
        isAttester[attester] = allowed;
        emit AttesterSet(attester, allowed);
    }

    /// @notice Allow or revoke a factory's ability to link a vault on its deployer's behalf.
    function setFactory(address factory, bool allowed) external onlyOwner {
        isFactory[factory] = allowed;
        emit FactorySet(factory, allowed);
    }

    // ── Publication ──────────────────────────────────────────────────────────

    /**
     * @notice Commit a manifest, attested by an authorised signer.
     * @param manifestHash Hash of the content-addressed manifest document.
     * @param uri Where the document can be fetched.
     * @param parent The id this refines or forks, or 0 for a root.
     * @param deadline Latest timestamp the attester's signature is good for.
     * @param signature The attester's EIP-712 signature.
     * @return id The new manifest id.
     */
    function publish(
        bytes32 manifestHash,
        string calldata uri,
        uint256 parent,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 id) {
        if (manifestHash == bytes32(0)) revert EmptyManifestHash();
        if (block.timestamp > deadline) revert AttestationExpired(deadline);

        uint256 existing = idOfHash[manifestHash];
        if (existing != 0) revert DuplicateManifest(manifestHash, existing);

        uint32 depth = 0;
        if (parent != 0) {
            Manifest storage p = _manifests[parent];
            if (p.manifestHash == bytes32(0)) revert UnknownManifest(parent);
            depth = p.depth + 1;
            // Bounded so the upward walk in `feeSplit` stays cheap for every descendant.
            if (depth > MAX_LINEAGE_DEPTH * 4) revert LineageTooDeep(depth);
        }

        address signer = ECDSA.recover(
            _hashTypedDataV4(
                keccak256(abi.encode(ATTESTATION_TYPEHASH, manifestHash, msg.sender, parent, deadline))
            ),
            signature
        );
        if (!isAttester[signer]) revert NotAnAttester(signer);

        id = ++count;
        _manifests[id] = Manifest({
            manifestHash: manifestHash,
            uri: uri,
            creator: msg.sender,
            attester: signer,
            parent: parent,
            depth: depth,
            publishedAt: uint64(block.timestamp),
            portfolio: address(0)
        });
        idOfHash[manifestHash] = id;
        if (parent != 0) _children[parent].push(id);

        emit Published(id, parent, msg.sender, manifestHash, signer, uri);
    }

    /// @notice Record the vault deployed for a manifest. Callable once, by its creator or a factory.
    /// @dev Kept separate from `publish` so a manifest can be published and inspected before anyone
    /// commits gas to a vault, and so the vault's constructor can read its own manifest id.
    function linkPortfolio(uint256 id, address portfolio) external {
        Manifest storage m = _manifests[id];
        if (m.manifestHash == bytes32(0)) revert UnknownManifest(id);
        if (msg.sender != m.creator && !isFactory[msg.sender]) revert NotCreatorOrFactory(msg.sender, m.creator);
        if (m.portfolio != address(0)) revert PortfolioAlreadyLinked(id, m.portfolio);
        m.portfolio = portfolio;
        emit PortfolioLinked(id, portfolio);
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    function manifest(uint256 id) external view returns (Manifest memory) {
        Manifest memory m = _manifests[id];
        if (m.manifestHash == bytes32(0)) revert UnknownManifest(id);
        return m;
    }

    function exists(uint256 id) external view returns (bool) {
        return _manifests[id].manifestHash != bytes32(0);
    }

    function children(uint256 id) external view returns (uint256[] memory) {
        return _children[id];
    }

    /// @notice The chain of ancestors above `id`, nearest first, capped at `MAX_LINEAGE_DEPTH`.
    function ancestors(uint256 id) public view returns (uint256[] memory ids) {
        uint256[] memory buf = new uint256[](MAX_LINEAGE_DEPTH);
        uint256 n;
        uint256 cursor = _manifests[id].parent;
        while (cursor != 0 && n < MAX_LINEAGE_DEPTH) {
            buf[n++] = cursor;
            cursor = _manifests[cursor].parent;
        }
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = buf[i];
        }
    }

    /**
     * @notice How a portfolio's fee divides between its own creator and its ancestors' creators.
     * @param id The portfolio's manifest id.
     * @return recipients Fee recipients, `recipients[0]` always being this portfolio's own creator.
     * @return bps Each recipient's share of the fee in basis points. Sums to exactly 10_000.
     * @dev The invariant that matters, and the one the test suite asserts by fuzz: the returned
     * shares sum to 10_000 exactly, for any tree shape and any depth, so lineage fees can never
     * exceed the fee collected. The remainder from the geometric decay, including every hop past
     * `MAX_LINEAGE_DEPTH`, is assigned to `recipients[0]` rather than left unallocated.
     */
    function feeSplit(uint256 id) external view returns (address[] memory recipients, uint256[] memory bps) {
        if (_manifests[id].manifestHash == bytes32(0)) revert UnknownManifest(id);
        uint256[] memory line = ancestors(id);

        recipients = new address[](line.length + 1);
        bps = new uint256[](line.length + 1);
        recipients[0] = _manifests[id].creator;

        uint256 remaining = LINEAGE_BUDGET_BPS;
        uint256 assigned;
        for (uint256 i; i < line.length; ++i) {
            // Each hop takes LINEAGE_DECAY_BPS of what is still in the lineage budget.
            uint256 cut = (remaining * LINEAGE_DECAY_BPS) / 10_000;
            recipients[i + 1] = _manifests[line[i]].creator;
            bps[i + 1] = cut;
            assigned += cut;
            remaining -= cut;
        }
        // Everything the tree did not claim stays with this portfolio's own creator.
        bps[0] = 10_000 - assigned;
    }
}
