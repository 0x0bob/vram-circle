// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProjectVault} from "./ProjectVault.sol";
import {IProjectFactory} from "../interfaces/IProjectFactory.sol";

/// @title ProjectFactory
/// @notice Deploys immutable EIP-1167 ProjectVault clones and holds protocol parameters.
/// @dev Parameters change only through `timelock` (a 48h TimelockController, wired in step 2).
///      The guardian can pause new projects/tasks/submissions but can never touch funds.
contract ProjectFactory is IProjectFactory {
    uint16 public constant MAX_FEE_BPS = 1500;
    uint32 public constant MAX_REVIEW_PERIOD = 30 days;
    uint32 public constant MIN_REVIEW_PERIOD_FLOOR = 1 days;

    address public immutable vaultImplementation;
    IERC20 public immutable usdc;
    address public immutable timelock;

    address public guardian;
    uint16 public feeBps;
    address public feeRouter;
    uint32 public minReviewPeriod;
    bool public paused;

    address[] public projects;
    mapping(address => bool) public isProject;

    event ProjectCreated(
        address indexed vault, address indexed creator, string metadataURI, uint16 creatorBps, uint32 reviewPeriod
    );
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event GuardianSet(address indexed guardian);
    event FeeBpsSet(uint16 feeBps);
    event FeeRouterSet(address indexed feeRouter);
    event MinReviewPeriodSet(uint32 minReviewPeriod);

    error NotGuardian();
    error NotTimelock();
    error IsPaused();
    error ZeroAddress();
    error FeeTooHigh();
    error BadReviewPeriod();
    error BadBps();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert NotTimelock();
        _;
    }

    constructor(
        address usdc_,
        address timelock_,
        address guardian_,
        address feeRouter_,
        uint16 feeBps_,
        uint32 minReviewPeriod_
    ) {
        if (usdc_ == address(0) || timelock_ == address(0) || guardian_ == address(0) || feeRouter_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (minReviewPeriod_ < MIN_REVIEW_PERIOD_FLOOR || minReviewPeriod_ > MAX_REVIEW_PERIOD) {
            revert BadReviewPeriod();
        }
        usdc = IERC20(usdc_);
        timelock = timelock_;
        guardian = guardian_;
        feeRouter = feeRouter_;
        feeBps = feeBps_;
        minReviewPeriod = minReviewPeriod_;
        vaultImplementation = address(new ProjectVault());
    }

    /// @notice Deploy a new project vault owned by the caller.
    /// @param metadataURI Off-chain project description.
    /// @param creatorBps Creator share of license revenue in bps (rest goes to contributors). Immutable.
    /// @param reviewPeriod Seconds after which an unreviewed submission is claimable as approved.
    function createProject(string calldata metadataURI, uint16 creatorBps, uint32 reviewPeriod)
        external
        returns (address vault)
    {
        if (paused) revert IsPaused();
        if (creatorBps > 10_000) revert BadBps();
        if (reviewPeriod < minReviewPeriod || reviewPeriod > MAX_REVIEW_PERIOD) revert BadReviewPeriod();
        vault = Clones.clone(vaultImplementation);
        ProjectVault(vault).initialize(msg.sender, address(this), address(usdc), creatorBps, reviewPeriod, metadataURI);
        projects.push(vault);
        isProject[vault] = true;
        emit ProjectCreated(vault, msg.sender, metadataURI, creatorBps, reviewPeriod);
    }

    /// @return Number of projects deployed.
    function projectCount() external view returns (uint256) {
        return projects.length;
    }

    // ---- guardian ----

    /// @notice Pause new projects, tasks and submissions. Never blocks claims or withdrawals.
    function pause() external onlyGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Lift the pause.
    function unpause() external onlyGuardian {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ---- timelocked parameters ----

    function setGuardian(address g) external onlyTimelock {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    function setFeeBps(uint16 bps) external onlyTimelock {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps;
        emit FeeBpsSet(bps);
    }

    function setFeeRouter(address r) external onlyTimelock {
        if (r == address(0)) revert ZeroAddress();
        feeRouter = r;
        emit FeeRouterSet(r);
    }

    function setMinReviewPeriod(uint32 p) external onlyTimelock {
        if (p < MIN_REVIEW_PERIOD_FLOOR || p > MAX_REVIEW_PERIOD) revert BadReviewPeriod();
        minReviewPeriod = p;
        emit MinReviewPeriodSet(p);
    }
}
