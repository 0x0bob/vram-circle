// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProjectFactory} from "../../src/core/ProjectFactory.sol";
import {ProjectVault} from "../../src/core/ProjectVault.sol";
import {FeeRouter} from "../../src/fees/FeeRouter.sol";

/// @dev Drives vault + router + factory together. Privileged roles (guardian, timelock address,
///      reviewer, stranger, "backend") call every privileged function they can reach.
contract ProtocolHandler is Test {
    MockUSDC public usdc;
    ProjectFactory public factory;
    ProjectVault public vault;
    FeeRouter public router;

    address public timelock;
    address public guardian;
    address public reviewer;
    address public stranger;
    address public creator;
    address public treasuryA;
    address public treasuryB;
    address[] public contributors;

    // ghost state
    uint256 public totalMinted;
    bool public pauseBlocked; // invariant 7
    bool public feeMismatch; // invariant 9
    uint256 public claims;
    uint256 public distributesWhilePaused;
    mapping(uint256 => uint16) public feeBpsAtCreation; // taskId => bps in force at creation

    constructor(
        MockUSDC u,
        ProjectFactory f,
        ProjectVault v,
        FeeRouter r,
        address tl,
        address g,
        address rev,
        address str,
        address cr,
        address tA,
        address tB
    ) {
        usdc = u;
        factory = f;
        vault = v;
        router = r;
        timelock = tl;
        guardian = g;
        reviewer = rev;
        stranger = str;
        creator = cr;
        treasuryA = tA;
        treasuryB = tB;
        for (uint256 i; i < 3; ++i) {
            contributors.push(makeAddr(string(abi.encodePacked("contrib", i))));
        }
    }

    // ---------------- vault lifecycle (creator / contributors / reviewer)

    function deposit(uint256 amt) external {
        amt = bound(amt, 1, 5_000e6);
        usdc.mint(creator, amt);
        totalMinted += amt;
        vm.startPrank(creator);
        usdc.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
    }

    function createTask(uint256 reward, uint32 max) external {
        reward = bound(reward, 1e6, 300e6);
        max = uint32(bound(max, 1, 6));
        uint16 bps = factory.feeBps();
        vm.prank(creator);
        try vault.createTask(
            ProjectVault.TaskParams(reward, max, uint64(block.timestamp + 20 days), bytes32(uint256(1)), false, 2)
        ) returns (
            uint256 id
        ) {
            feeBpsAtCreation[id] = bps;
        } catch {}
    }

    function submit(uint256 cSeed, uint256 tSeed) external {
        if (vault.taskCount() == 0) return;
        address c = contributors[cSeed % contributors.length];
        uint256 t = (tSeed % vault.taskCount()) + 1; // compute before prank: prank covers only the next call
        vm.prank(c);
        try vault.submit(t, bytes32(tSeed), "u") {} catch {}
    }

    function review(address who, uint256 sSeed, bool approve) external {
        if (vault.submissionCount() == 0) return;
        uint256 s = (sSeed % vault.submissionCount()) + 1;
        // privileged and unprivileged callers alike
        address caller = who == address(0) ? reviewer : (sSeed % 3 == 0 ? stranger : reviewer);
        vm.prank(caller);
        if (approve) {
            try vault.approve(s) {} catch {}
        } else {
            try vault.reject(s, bytes32(uint256(9))) {} catch {}
        }
    }

    /// @dev Claim; check invariant 9 (fee exactly the snapshotted bps) and that payee == contributor.
    function claim(uint256 sSeed) external {
        if (vault.submissionCount() == 0) return;
        uint256 s = (sSeed % vault.submissionCount()) + 1;
        ProjectVault.Submission memory sub = vault.getSubmission(s);
        ProjectVault.Task memory tk = vault.getTask(sub.taskId);
        uint256 routerBefore = usdc.balanceOf(address(router));
        uint256 cBefore = usdc.balanceOf(sub.contributor);
        bool paused = factory.paused();
        vm.prank(sub.contributor);
        try vault.claim(s) {
            claims++;
            uint256 expectedFee = (tk.reward * feeBpsAtCreation[sub.taskId]) / 10_000;
            if (usdc.balanceOf(address(router)) - routerBefore != expectedFee) feeMismatch = true;
            if (expectedFee > (tk.reward * 1500) / 10_000) feeMismatch = true;
            if (usdc.balanceOf(sub.contributor) - cBefore != tk.reward) feeMismatch = true;
        } catch {
            // an approved or auto-approvable submission must be claimable even when paused
            if (paused && sub.status == ProjectVault.Status.Approved) pauseBlocked = true;
        }
    }

    function closeAndWithdraw(uint256 tSeed, uint256 amt) external {
        if (vault.taskCount() != 0) {
            uint256 t = (tSeed % vault.taskCount()) + 1;
            vm.prank(creator);
            try vault.closeTask(t) {} catch {}
        }
        uint256 u = vault.unreserved();
        if (u == 0) return;
        bool paused = factory.paused();
        vm.prank(creator);
        try vault.withdrawUnreserved(bound(amt, 1, u)) {}
        catch {
            if (paused) pauseBlocked = true;
        }
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 4 days));
    }

    // ---------------- privileged roles

    function guardianPause(bool p) external {
        vm.prank(guardian);
        if (p) factory.pause();
        else factory.unpause();
    }

    function timelockSetFee(uint16 bps) external {
        bps = uint16(bound(bps, 0, 1500));
        vm.prank(timelock);
        factory.setFeeBps(bps);
    }

    function timelockSetTreasury(bool a) external {
        vm.prank(timelock);
        router.setTreasury(a ? treasuryA : treasuryB);
    }

    /// @dev Roles with power try every privileged entry point with attacker-chosen arguments.
    function privilegedAttacks(uint256 roleSeed, address to, uint256 amount) external {
        address[4] memory roles = [guardian, reviewer, stranger, timelock];
        address caller = roles[roleSeed % 4];
        vm.startPrank(caller);
        // guardian/reviewer/stranger must not be able to touch params or the treasury
        if (caller != timelock) {
            try router.setTreasury(to) {
                feeMismatch = true;
            } catch {}
            try factory.setFeeRouter(to) {
                feeMismatch = true;
            } catch {}
        }
        // nobody but the creator can withdraw vault budget
        if (caller != creator) {
            try vault.withdrawUnreserved(amount) {
                feeMismatch = true;
            } catch {}
        }
        vm.stopPrank();
    }

    /// @dev Permissionless; works regardless of pause (invariant 7).
    function distribute(address caller) external {
        bool paused = factory.paused();
        vm.prank(caller);
        try router.distribute() {
            if (paused) distributesWhilePaused++;
        } catch {
            pauseBlocked = true;
        }
    }
}

contract ProtocolInvariantTest is Test {
    MockUSDC usdc;
    ProjectFactory factory;
    ProjectVault vault;
    FeeRouter router;
    ProtocolHandler h;

    address timelock = makeAddr("timelock");
    address guardian = makeAddr("guardian");
    address reviewer = makeAddr("reviewer");
    address stranger = makeAddr("stranger");
    address creator = makeAddr("creator");
    address treasuryA = makeAddr("treasuryA");
    address treasuryB = makeAddr("treasuryB");

    function setUp() public {
        usdc = new MockUSDC();
        router = new FeeRouter(address(usdc), timelock, treasuryA);
        factory = new ProjectFactory(address(usdc), timelock, guardian, address(router), 1000, 3 days);
        vm.prank(creator);
        vault = ProjectVault(factory.createProject("m", 5000, 7 days));
        vm.prank(creator);
        vault.setReviewer(reviewer, true);
        h = new ProtocolHandler(
            usdc, factory, vault, router, timelock, guardian, reviewer, stranger, creator, treasuryA, treasuryB
        );
        targetContract(address(h));
    }

    /// Invariant 6: privileged roles (guardian, timelock, stranger/backend) never gain USDC through
    /// admin paths. The reviewer is a contributor-less role here, so it must stay at zero too.
    function invariant_privilegedRolesNeverReceiveUsdc() public view {
        assertEq(usdc.balanceOf(guardian), 0);
        assertEq(usdc.balanceOf(timelock), 0);
        assertEq(usdc.balanceOf(reviewer), 0);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    /// Invariant 6: all USDC is always held by the vault, the router, a treasury, a contributor or the creator.
    function invariant_noUsdcLeaksOutsideKnownHolders() public view {
        uint256 held = usdc.balanceOf(address(vault)) + usdc.balanceOf(address(router)) + usdc.balanceOf(treasuryA)
            + usdc.balanceOf(treasuryB) + usdc.balanceOf(creator);
        for (uint256 i; i < 3; ++i) {
            held += usdc.balanceOf(h.contributors(i));
        }
        assertEq(held, h.totalMinted());
    }

    /// Invariant 6 (access control): no non-timelock caller changed the treasury/router or withdrew
    /// vault budget, and every claim paid the contributor exactly the task reward.
    function invariant_noUnauthorizedStateChange() public view {
        assertFalse(h.feeMismatch());
        assertEq(factory.feeRouter(), address(router));
    }

    /// Invariant 7: pause never blocks claim, withdrawUnreserved or FeeRouter.distribute.
    function invariant_pauseNeverBlocksPayouts() public view {
        assertFalse(h.pauseBlocked());
    }

    /// Invariant 9: fee equals the configured bps (snapshotted per task) and is always <= 15%.
    function invariant_feeEqualsConfiguredAndBounded() public view {
        assertLe(factory.feeBps(), 1500);
        assertFalse(h.feeMismatch());
    }
}
