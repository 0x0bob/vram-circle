// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProjectFactory} from "../../src/core/ProjectFactory.sol";
import {ProjectVault} from "../../src/core/ProjectVault.sol";

/// @dev Drives pause/unpause, timelock parameter changes, attacker parameter changes and
///      claim/withdraw attempts while paused. Violations are recorded in ghost flags.
contract FactoryHandler is Test {
    MockUSDC public usdc;
    ProjectFactory public factory;
    address public timelock;
    address public guardian;
    address public feeRouter;

    // ghost mirrors of the last value the timelock successfully set
    uint16 public ghostFeeBps;
    uint32 public ghostMinReview;
    bool public breachedAccessControl; // a non-timelock caller changed a parameter
    bool public wrongRevert; // a timelock call with an in-bounds value reverted
    bool public claimOrWithdrawBlocked; // pause blocked claim or withdrawUnreserved

    address[] public projects;
    mapping(address => uint32) public minAtCreation;

    // dedicated vault for the pause-vs-claim check
    ProjectVault public vault;
    address public vaultCreator;
    address public contributor;
    uint256[] public approvedQueue;
    uint256 public settledWhilePaused;

    constructor(MockUSDC u, ProjectFactory f, address tl, address g, address fr) {
        usdc = u;
        factory = f;
        timelock = tl;
        guardian = g;
        feeRouter = fr;
        ghostFeeBps = f.feeBps();
        ghostMinReview = f.minReviewPeriod();
        vaultCreator = makeAddr("vaultCreator");
        contributor = makeAddr("contributor");
        vm.prank(vaultCreator);
        vault = ProjectVault(f.createProject("m", 5000, 7 days));
    }

    function createProject(uint256 caller, uint32 period, uint16 bps) external {
        address c = address(uint160(bound(caller, 1, 20)));
        period = uint32(bound(period, 0, 40 days));
        vm.prank(c);
        try factory.createProject("m", bps, period) returns (address v) {
            projects.push(v);
            minAtCreation[v] = factory.minReviewPeriod();
        } catch {}
    }

    function pause() external {
        vm.prank(guardian);
        factory.pause();
    }

    function unpause() external {
        vm.prank(guardian);
        factory.unpause();
    }

    function timelockSetFee(uint16 bps) external {
        bps = uint16(bound(bps, 0, 3000));
        vm.prank(timelock);
        try factory.setFeeBps(bps) {
            ghostFeeBps = bps;
        } catch {
            if (bps <= 1500) wrongRevert = true;
        }
    }

    function timelockSetMinReview(uint32 p) external {
        p = uint32(bound(p, 0, 40 days));
        vm.prank(timelock);
        try factory.setMinReviewPeriod(p) {
            ghostMinReview = p;
        } catch {
            if (p >= 1 days && p <= 30 days) wrongRevert = true;
        }
    }

    /// @dev Any caller other than the timelock (guardian and vault creators included) must fail.
    function attackerSetsParams(uint256 callerSeed, uint256 kind, uint256 value) external {
        address caller = address(uint160(bound(callerSeed, 1, 1000)));
        if (caller == timelock) caller = guardian;
        vm.startPrank(caller);
        bool ok;
        kind = kind % 4;
        if (kind == 0) {
            try factory.setFeeBps(uint16(value)) {
                ok = true;
            } catch {}
        } else if (kind == 1) {
            try factory.setMinReviewPeriod(uint32(value)) {
                ok = true;
            } catch {}
        } else if (kind == 2) {
            try factory.setFeeRouter(address(uint160(value))) {
                ok = true;
            } catch {}
        } else {
            try factory.setGuardian(address(uint160(value))) {
                ok = true;
            } catch {}
        }
        vm.stopPrank();
        if (ok) breachedAccessControl = true;
    }

    /// @dev Stage one approved, unclaimed submission in the dedicated vault (needs an unpaused factory).
    function stage() external {
        if (factory.paused()) return;
        usdc.mint(vaultCreator, 110e6);
        vm.startPrank(vaultCreator);
        usdc.approve(address(vault), 110e6);
        vault.deposit(110e6);
        uint256 t = vault.createTask(
            ProjectVault.TaskParams(100e6, 1, uint64(block.timestamp + 20 days), bytes32(uint256(1)), false, 1)
        );
        vm.stopPrank();
        vm.prank(contributor);
        uint256 s = vault.submit(t, bytes32(uint256(2)), "u");
        vm.prank(vaultCreator);
        vault.approve(s);
        approvedQueue.push(s);
    }

    /// @dev Pause, then claim the oldest staged submission and withdraw unreserved budget.
    ///      Pause must block neither.
    function settleWhilePaused() external {
        vm.prank(guardian);
        factory.pause();

        if (approvedQueue.length != 0) {
            uint256 s = approvedQueue[approvedQueue.length - 1];
            approvedQueue.pop();
            vm.prank(contributor);
            try vault.claim(s) {
                settledWhilePaused++;
            } catch {
                claimOrWithdrawBlocked = true;
            }
        }

        uint256 u = vault.unreserved();
        if (u != 0) {
            vm.prank(vaultCreator);
            try vault.withdrawUnreserved(u) {}
            catch {
                claimOrWithdrawBlocked = true;
            }
        }
    }

    function projectsLength() external view returns (uint256) {
        return projects.length;
    }
}

contract FactoryInvariantTest is Test {
    MockUSDC usdc;
    ProjectFactory factory;
    FactoryHandler h;
    address timelock = makeAddr("timelock");
    address guardian = makeAddr("guardian");
    address feeRouter = makeAddr("feeRouter");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new ProjectFactory(address(usdc), timelock, guardian, feeRouter, 1000, 3 days);
        h = new FactoryHandler(usdc, factory, timelock, guardian, feeRouter);
        targetContract(address(h));
    }

    /// Invariant 9: fee is never above 15%.
    function invariant_feeNeverAbove1500() public view {
        assertLe(factory.feeBps(), 1500);
    }

    /// The factory's fee and min review period equal what the timelock last set (nobody else can move them).
    function invariant_onlyTimelockChangesParams() public view {
        assertEq(factory.feeBps(), h.ghostFeeBps());
        assertEq(factory.minReviewPeriod(), h.ghostMinReview());
        assertEq(factory.feeRouter(), feeRouter);
        assertEq(factory.guardian(), guardian);
        assertFalse(h.breachedAccessControl());
    }

    /// Timelock calls with in-bounds values must never revert.
    function invariant_timelockInBoundsNeverReverts() public view {
        assertFalse(h.wrongRevert());
    }

    /// The minimum review period always stays within [1 day, 30 days].
    function invariant_minReviewPeriodBounded() public view {
        assertGe(factory.minReviewPeriod(), 1 days);
        assertLe(factory.minReviewPeriod(), 30 days);
    }

    /// No project was ever created below the minimum in force at its creation, or above 30 days.
    function invariant_reviewPeriodNeverBelowMinimum() public view {
        for (uint256 i; i < h.projectsLength(); ++i) {
            address p = h.projects(i);
            uint32 rp = ProjectVault(p).reviewPeriod();
            assertGe(rp, h.minAtCreation(p));
            assertLe(rp, 30 days);
        }
    }

    /// Invariant 7: pause never blocks claim or withdrawUnreserved.
    function invariant_pauseNeverBlocksClaimOrWithdraw() public view {
        assertFalse(h.claimOrWithdrawBlocked());
    }

    /// Accounting identity also holds for the vault driven through pause/claim/withdraw.
    function invariant_balanceMatchesAccountingInDedicatedVault() public view {
        ProjectVault v = h.vault();
        assertEq(usdc.balanceOf(address(v)), v.unreserved() + v.reserved());
    }
}
