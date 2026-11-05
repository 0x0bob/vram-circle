// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IProjectFactory} from "../interfaces/IProjectFactory.sol";

/// @title ProjectVault
/// @notice One immutable clone per project: budget, tasks, submissions, reviews, claims.
/// @dev Accounting identity: USDC balance == unreserved + reserved (invariant 1).
///      Pull payments only: contributors call `claim`. No admin/guardian/reviewer path moves funds
///      anywhere except the contributor (reward) and the fee router (fee) on a claim, or the creator
///      via `withdrawUnreserved`.
contract ProjectVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    enum Status {
        None,
        Submitted,
        Approved,
        Rejected,
        Claimed
    }

    struct TaskParams {
        uint256 reward; // net amount the contributor receives
        uint32 maxSubmissions;
        uint64 deadline;
        bytes32 specHash;
        bool allowlistOnly;
        uint32 maxPerContributor;
    }

    struct Task {
        uint256 reward;
        uint256 feePerSubmission; // snapshot of fee at creation, so reservation stays exact
        uint64 deadline;
        bytes32 specHash;
        uint32 maxSubmissions;
        uint32 maxPerContributor;
        uint32 active; // non-rejected submissions (pending + approved + claimed)
        uint32 claimed;
        uint32 reservedUnits; // reward+fee units still held in reservation
        bool allowlistOnly;
        bool closed;
    }

    struct Submission {
        address contributor;
        uint64 submittedAt;
        uint32 taskId;
        Status status;
        bytes32 contentHash;
    }

    IERC20 public usdc;
    IProjectFactory public factory;
    address public creator;
    uint16 public creatorBps;
    uint32 public reviewPeriod;
    string public metadataURI;

    /// @notice Budget deposited and not reserved by any task.
    uint256 public unreserved;
    /// @notice Budget reserved by open tasks and unclaimed submissions.
    uint256 public reserved;

    uint256 public taskCount;
    uint256 public submissionCount;
    mapping(uint256 => Task) internal _tasks;
    mapping(uint256 => Submission) internal _submissions;
    mapping(address => bool) public isReviewer;
    mapping(uint256 => mapping(address => bool)) public allowlisted;
    mapping(uint256 => mapping(address => uint32)) public contributorCount;

    event Deposited(address indexed from, uint256 amount);
    event ReviewerSet(address indexed reviewer, bool allowed);
    event TaskCreated(
        uint256 indexed taskId,
        uint256 reward,
        uint256 fee,
        uint32 maxSubmissions,
        uint64 deadline,
        bytes32 specHash,
        bool allowlistOnly,
        uint32 maxPerContributor
    );
    event AllowlistSet(uint256 indexed taskId, address indexed account, bool allowed);
    event TaskOpened(uint256 indexed taskId);
    event TaskClosed(uint256 indexed taskId, uint256 released);
    event Submitted(
        uint256 indexed taskId,
        uint256 indexed submissionId,
        address indexed contributor,
        bytes32 contentHash,
        string uri
    );
    event Approved(uint256 indexed taskId, uint256 indexed submissionId, address indexed contributor, address reviewer);
    event Rejected(
        uint256 indexed taskId,
        uint256 indexed submissionId,
        address indexed contributor,
        address reviewer,
        bytes32 reasonHash
    );
    event AutoApproved(uint256 indexed taskId, uint256 indexed submissionId, address indexed contributor);
    event Claimed(
        uint256 indexed taskId, uint256 indexed submissionId, address indexed contributor, uint256 reward, uint256 fee
    );
    event UnreservedWithdrawn(address indexed to, uint256 amount);

    error NotCreator();
    error NotReviewerOrCreator();
    error NotContributor();
    error IsPaused();
    error ZeroAmount();
    error BadParams();
    error UnknownTask();
    error UnknownSubmission();
    error InsufficientUnreserved();
    error TaskClosedError();
    error TaskPastDeadline();
    error NotAllowlisted();
    error TaskFull();
    error ContributorLimit();
    error NotSubmitted();
    error ReviewWindowClosed();
    error NotClaimable();
    error ReasonRequired();
    error AlreadyClosed();
    error AlreadyOpen();

    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    modifier onlyReviewerOrCreator() {
        if (msg.sender != creator && !isReviewer[msg.sender]) revert NotReviewerOrCreator();
        _;
    }

    modifier whenNotPaused() {
        if (factory.paused()) revert IsPaused();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @notice Called once by the factory right after cloning.
    function initialize(
        address creator_,
        address factory_,
        address usdc_,
        uint16 creatorBps_,
        uint32 reviewPeriod_,
        string calldata metadataURI_
    ) external initializer {
        creator = creator_;
        factory = IProjectFactory(factory_);
        usdc = IERC20(usdc_);
        creatorBps = creatorBps_;
        reviewPeriod = reviewPeriod_;
        metadataURI = metadataURI_;
    }

    // ---------------------------------------------------------------- budget

    /// @notice Fund the project. Anyone can deposit; only the creator can withdraw unreserved budget.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        unreserved += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Creator exits budget not reserved by any task. Never blocked by pause.
    function withdrawUnreserved(uint256 amount) external onlyCreator nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > unreserved) revert InsufficientUnreserved();
        unreserved -= amount;
        usdc.safeTransfer(creator, amount);
        emit UnreservedWithdrawn(creator, amount);
    }

    // ----------------------------------------------------------------- admin

    /// @notice Add or remove a human reviewer. Reviewers can only approve/reject this project's submissions.
    function setReviewer(address r, bool allowed) external onlyCreator {
        isReviewer[r] = allowed;
        emit ReviewerSet(r, allowed);
    }

    // ----------------------------------------------------------------- tasks

    /// @notice Open a task. `t.reward` is the NET amount the contributor receives; the protocol fee
    ///         (factory feeBps, snapshotted now) is charged ON TOP. The vault reserves
    ///         `(reward + fee) * maxSubmissions` up front, so the task cannot open unless fully funded.
    ///         The contributor never pays the fee.
    function createTask(TaskParams calldata t) external onlyCreator whenNotPaused returns (uint256 taskId) {
        if (t.reward == 0 || t.maxSubmissions == 0 || t.maxPerContributor == 0) revert BadParams();
        if (t.deadline <= block.timestamp) revert BadParams();
        uint256 fee = (t.reward * factory.feeBps()) / BPS;
        uint256 total = (t.reward + fee) * t.maxSubmissions;
        if (total > unreserved) revert InsufficientUnreserved();

        unreserved -= total;
        reserved += total;
        taskId = ++taskCount;
        _tasks[taskId] = Task({
            reward: t.reward,
            feePerSubmission: fee,
            deadline: t.deadline,
            specHash: t.specHash,
            maxSubmissions: t.maxSubmissions,
            maxPerContributor: t.maxPerContributor,
            active: 0,
            claimed: 0,
            reservedUnits: t.maxSubmissions,
            allowlistOnly: t.allowlistOnly,
            closed: false
        });
        emit TaskCreated(
            taskId, t.reward, fee, t.maxSubmissions, t.deadline, t.specHash, t.allowlistOnly, t.maxPerContributor
        );
    }

    /// @notice Add or remove addresses allowed to submit to an allowlist-only task.
    function setAllowlist(uint256 taskId, address[] calldata a, bool allowed) external onlyCreator {
        if (taskId == 0 || taskId > taskCount) revert UnknownTask();
        for (uint256 i; i < a.length; ++i) {
            allowlisted[taskId][a[i]] = allowed;
            emit AllowlistSet(taskId, a[i], allowed);
        }
    }

    /// @notice Open an allowlist-only task to everyone. One-way.
    function openTask(uint256 taskId) external onlyCreator {
        Task storage t = _task(taskId);
        if (!t.allowlistOnly) revert AlreadyOpen();
        t.allowlistOnly = false;
        emit TaskOpened(taskId);
    }

    /// @notice Stop new submissions and release unused reservation to unreserved budget.
    ///         Pending submissions keep their reservation until reviewed or auto-approved.
    function closeTask(uint256 taskId) external onlyCreator {
        Task storage t = _task(taskId);
        if (t.closed) revert AlreadyClosed();
        t.closed = true;
        uint32 inFlight = t.active - t.claimed;
        uint32 free = t.reservedUnits - inFlight;
        uint256 released = uint256(free) * (t.reward + t.feePerSubmission);
        t.reservedUnits = inFlight;
        reserved -= released;
        unreserved += released;
        emit TaskClosed(taskId, released);
    }

    // ----------------------------------------------------------- submissions

    /// @notice Submit work. Reverts when the task is full, closed, past deadline or the caller is not allowed.
    /// @param contentHash Hash of the off-chain content.
    /// @param uri Location of the (encrypted) content; emitted, not stored.
    function submit(uint256 taskId, bytes32 contentHash, string calldata uri)
        external
        whenNotPaused
        returns (uint256 id)
    {
        Task storage t = _task(taskId);
        if (t.closed) revert TaskClosedError();
        if (block.timestamp >= t.deadline) revert TaskPastDeadline();
        if (t.allowlistOnly && !allowlisted[taskId][msg.sender]) revert NotAllowlisted();
        if (t.active >= t.maxSubmissions) revert TaskFull();
        if (contributorCount[taskId][msg.sender] >= t.maxPerContributor) revert ContributorLimit();

        t.active++;
        contributorCount[taskId][msg.sender]++;
        id = ++submissionCount;
        _submissions[id] = Submission({
            contributor: msg.sender,
            submittedAt: uint64(block.timestamp),
            taskId: uint32(taskId),
            status: Status.Submitted,
            contentHash: contentHash
        });
        emit Submitted(taskId, id, msg.sender, contentHash, uri);
    }

    /// @notice Approve a pending submission before its review deadline.
    function approve(uint256 submissionId) external onlyReviewerOrCreator {
        Submission storage s = _pending(submissionId);
        s.status = Status.Approved;
        emit Approved(s.taskId, submissionId, s.contributor, msg.sender);
    }

    /// @notice Reject a pending submission before its review deadline. A reason hash is required.
    ///         Rejection frees the slot; once the task is closed it also frees the reservation.
    function reject(uint256 submissionId, bytes32 reasonHash) external onlyReviewerOrCreator {
        if (reasonHash == bytes32(0)) revert ReasonRequired();
        Submission storage s = _pending(submissionId);
        s.status = Status.Rejected;
        Task storage t = _tasks[s.taskId];
        t.active--;
        contributorCount[s.taskId][s.contributor]--;
        if (t.closed) {
            uint256 unit = t.reward + t.feePerSubmission;
            t.reservedUnits--;
            reserved -= unit;
            unreserved += unit;
        }
        emit Rejected(s.taskId, submissionId, s.contributor, msg.sender, reasonHash);
    }

    /// @notice Contributor collects the reward. Works for approved submissions, and for submissions
    ///         unreviewed past the review deadline (auto-approved). Fee goes to the fee router.
    function claim(uint256 submissionId) external nonReentrant {
        if (submissionId == 0 || submissionId > submissionCount) revert UnknownSubmission();
        Submission storage s = _submissions[submissionId];
        if (msg.sender != s.contributor) revert NotContributor();
        Task storage t = _tasks[s.taskId];

        if (s.status == Status.Submitted) {
            if (block.timestamp < uint256(s.submittedAt) + reviewPeriod) revert NotClaimable();
            emit AutoApproved(s.taskId, submissionId, s.contributor);
        } else if (s.status != Status.Approved) {
            revert NotClaimable();
        }

        uint256 reward = t.reward;
        uint256 fee = t.feePerSubmission;
        s.status = Status.Claimed;
        t.claimed++;
        t.reservedUnits--;
        reserved -= reward + fee;

        usdc.safeTransfer(msg.sender, reward);
        if (fee != 0) usdc.safeTransfer(factory.feeRouter(), fee);
        emit Claimed(s.taskId, submissionId, msg.sender, reward, fee);
    }

    // ----------------------------------------------------------------- views

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function getSubmission(uint256 submissionId) external view returns (Submission memory) {
        return _submissions[submissionId];
    }

    /// @return Timestamp after which an unreviewed submission is claimable as approved.
    function reviewDeadline(uint256 submissionId) external view returns (uint256) {
        return uint256(_submissions[submissionId].submittedAt) + reviewPeriod;
    }

    // -------------------------------------------------------------- internal

    function _task(uint256 taskId) internal view returns (Task storage t) {
        if (taskId == 0 || taskId > taskCount) revert UnknownTask();
        t = _tasks[taskId];
    }

    function _pending(uint256 submissionId) internal view returns (Submission storage s) {
        if (submissionId == 0 || submissionId > submissionCount) revert UnknownSubmission();
        s = _submissions[submissionId];
        if (s.status != Status.Submitted) revert NotSubmitted();
        if (block.timestamp >= uint256(s.submittedAt) + reviewPeriod) revert ReviewWindowClosed();
    }
}
