// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIdentityRegistry {
    function isAgent(uint256 agentId) external view returns (bool);
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title ERC-8004 Reputation Registry
/// @notice Stores signed-by-tx-sender reputation feedback about registered
///         agents. Scores are clamped to [-100, 100]. Aggregates are updated
///         in-place so reads are O(1).
contract ReputationRegistry {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    IIdentityRegistry public immutable identityRegistry;

    struct Feedback {
        address from;
        int8 score;
        uint64 timestamp;
        string uri; // optional ipfs:// pointer to review details
    }

    struct Aggregate {
        int256 sum;
        uint256 count;
    }

    mapping(uint256 => Feedback[]) private _feedback;
    mapping(uint256 => Aggregate) private _aggregate;
    // agentId => reviewer => hasSubmitted (one review per address per agent)
    mapping(uint256 => mapping(address => bool)) public hasReviewed;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event FeedbackSubmitted(
        uint256 indexed agentId,
        address indexed from,
        int8 score,
        string uri
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error UnknownAgent();
    error AlreadyReviewed();
    error ScoreOutOfRange();
    error SelfReviewForbidden();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address identityRegistry_) {
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    // ---------------------------------------------------------------------
    // Submit
    // ---------------------------------------------------------------------

    function submitFeedback(uint256 agentId, int8 score, string calldata uri) external {
        if (score < -100 || score > 100) revert ScoreOutOfRange();
        if (!identityRegistry.isAgent(agentId)) revert UnknownAgent();
        if (identityRegistry.ownerOf(agentId) == msg.sender) revert SelfReviewForbidden();
        if (hasReviewed[agentId][msg.sender]) revert AlreadyReviewed();

        hasReviewed[agentId][msg.sender] = true;
        _feedback[agentId].push(
            Feedback({
                from: msg.sender,
                score: score,
                timestamp: uint64(block.timestamp),
                uri: uri
            })
        );

        Aggregate storage agg = _aggregate[agentId];
        agg.sum += int256(score);
        unchecked {
            agg.count++;
        }

        emit FeedbackSubmitted(agentId, msg.sender, score, uri);
    }

    // ---------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------

    /// @notice Return (average * 100, count) so callers can divide client-side
    ///         without losing precision. Returns (0, 0) for unreviewed agents.
    function getReputation(uint256 agentId) external view returns (int256 avgX100, uint256 count) {
        Aggregate storage agg = _aggregate[agentId];
        count = agg.count;
        if (count == 0) return (0, 0);
        avgX100 = (agg.sum * 100) / int256(count);
    }

    function getFeedbackCount(uint256 agentId) external view returns (uint256) {
        return _feedback[agentId].length;
    }

    function getFeedback(uint256 agentId, uint256 index) external view returns (Feedback memory) {
        return _feedback[agentId][index];
    }

    function getFeedbackRange(uint256 agentId, uint256 offset, uint256 limit)
        external
        view
        returns (Feedback[] memory out)
    {
        Feedback[] storage all = _feedback[agentId];
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        if (offset >= end) return new Feedback[](0);
        out = new Feedback[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = all[i];
        }
    }
}
