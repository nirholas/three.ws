// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Portfolio} from "./Portfolio.sol";
import {PortfolioRegistry} from "./PortfolioRegistry.sol";

/**
 * @title PortfolioFactory
 * @notice Deploys the vault for a published manifest and links it, in one transaction.
 * @dev The factory holds no assets, has no owner, and has no privileges over anything it deploys.
 * It exists for two reasons only: so creating a portfolio is one transaction rather than a deploy
 * followed by a link, and so `Deployed` gives indexers a single event to follow. Every parameter it
 * passes through is checked by `Portfolio`'s own constructor, so a malformed call fails there rather
 * than producing a vault in a bad state.
 */
contract PortfolioFactory {
    /// @notice The registry every portfolio from this factory is published in.
    PortfolioRegistry public immutable registry;

    /// @notice Every vault this factory has deployed, in order.
    address[] public deployments;

    event Deployed(uint256 indexed manifestId, address indexed portfolio, address indexed creator);

    error NotTheCreator(address caller, address creator);
    error AlreadyDeployed(uint256 manifestId, address portfolio);

    constructor(address registry_) {
        registry = PortfolioRegistry(registry_);
    }

    /// @notice How many vaults this factory has deployed.
    function deploymentCount() external view returns (uint256) {
        return deployments.length;
    }

    /**
     * @notice Deploy the vault for `manifestId` and record it on the manifest.
     * @dev Only the manifest's own creator may call this, so an approved factory can never link a
     * vault to somebody else's manifest.
     */
    /**
     * @notice Deploy the vault for `config.manifestId` and record it on the manifest.
     * @dev Only the manifest's own creator may call this, so an approved factory can never link a
     * vault to somebody else's manifest. `config.registry` is overwritten with this factory's own
     * registry rather than trusted from the caller, so a vault can never be deployed pointing at a
     * registry that does not contain the manifest it claims.
     */
    function deploy(Portfolio.Config memory config) external returns (address portfolio) {
        PortfolioRegistry.Manifest memory m = registry.manifest(config.manifestId);
        if (msg.sender != m.creator) revert NotTheCreator(msg.sender, m.creator);
        if (m.portfolio != address(0)) revert AlreadyDeployed(config.manifestId, m.portfolio);

        config.registry = address(registry);
        portfolio = address(new Portfolio(config));

        deployments.push(portfolio);
        registry.linkPortfolio(config.manifestId, portfolio);
        emit Deployed(config.manifestId, portfolio, msg.sender);
    }
}
