// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProjectFactory} from "../../src/core/ProjectFactory.sol";
import {ProjectVault} from "../../src/core/ProjectVault.sol";

contract VaultHandler is Test {
    MockUSDC public usdc;
    ProjectFactory public factory;
    ProjectVault public vault;
    address public creator;
    address public reviewer;
    address public feeRouter;
    address[] public actors;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalPaidToContributors;
    uint256 public totalPaidFees;
    mapping(uint256 => uint256) public paidCount; // submission => times paid
    mapping(uint256 => uint256) public paidPerTask;
    mapping(uint256 => bool) public everRejected;
    mapping(uint256 => bool) public everClaimed;

    constructor(MockUSDC u, ProjectFactory f, ProjectVault v, address c, address r, address fr) {
        usdc = u;
        factory = f;
        vault = v;
        creator = c;
        reviewer = r;
        feeRouter = fr;
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string(abi.encodePacked("actor", i))));
        }
    }

    function deposit(uint256 amt) external {
        amt = bound(amt, 1, 10_000e6);
        usdc.mint(creator, amt);
        vm.startPrank(creator);
        usdc.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
        totalDeposited += amt;
    }

    function createTask(uint256 reward, uint32 max, uint32 perC) external {
        reward = bound(reward, 1e6, 500e6);
        max = uint32(bound(max, 1, 8));
        perC = uint32(bound(perC, 1, 3));
        vm.prank(creator);
        try vault.createTask(
            ProjectVault.TaskParams(reward, max, uint64(block.timestamp + 20 days), bytes32(uint256(1)), false, perC)
        ) {}
            catch {}
    }

    function submit(uint256 actorSeed, uint256 taskSeed) external {
        if (vault.taskCount() == 0) return;
        address a = actors[actorSeed % actors.length];
        uint256 t = (taskSeed % vault.taskCount()) + 1;
        vm.prank(a);
        try vault.submit(t, bytes32(taskSeed), "u") {} catch {}
    }

    function review(uint256 subSeed, bool approve) external {
        if (vault.submissionCount() == 0) return;
        uint256 s = (subSeed % vault.submissionCount()) + 1;
        vm.prank(reviewer);
        if (approve) {
            try vault.approve(s) {} catch {}
        } else {
            try vault.reject(s, bytes32(uint256(7))) {
                everRejected[s] = true;
            } catch {}
        }
    }

    function claim(uint256 subSeed) external {
        if (vault.submissionCount() == 0) return;
        uint256 s = (subSeed % vault.submissionCount()) + 1;
        ProjectVault.Submission memory sub = vault.getSubmission(s);
        ProjectVault.Task memory tk = vault.getTask(sub.taskId);
        uint256 before = usdc.balanceOf(sub.contributor);
        vm.prank(sub.contributor);
        try vault.claim(s) {
            paidCount[s]++;
            paidPerTask[sub.taskId] += tk.reward;
            totalPaidToContributors += tk.reward;
            totalPaidFees += tk.feePerSubmission;
            everClaimed[s] = true;
            require(usdc.balanceOf(sub.contributor) == before + tk.reward, "wrong payee");
        } catch {}
    }

    function closeTask(uint256 taskSeed) external {
        if (vault.taskCount() == 0) return;
        vm.prank(creator);
        try vault.closeTask((taskSeed % vault.taskCount()) + 1) {} catch {}
    }

    function withdraw(uint256 amt) external {
        uint256 u = vault.unreserved();
        if (u == 0) return;
        amt = bound(amt, 1, u);
        vm.prank(creator);
        vault.withdrawUnreserved(amt);
        totalWithdrawn += amt;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 5 days));
    }

    function togglePause(bool p) external {
        vm.prank(factory.guardian());
        if (p) factory.pause();
        else factory.unpause();
    }
}

contract VaultInvariantTest is Test {
    MockUSDC usdc;
    ProjectFactory factory;
    ProjectVault vault;
    VaultHandler h;
    address creator = makeAddr("creator");
    address reviewer = makeAddr("reviewer");
    address feeRouter = makeAddr("feeRouter");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new ProjectFactory(address(usdc), makeAddr("tl"), makeAddr("g"), feeRouter, 1000, 3 days);
        vm.prank(creator);
        vault = ProjectVault(factory.createProject("m", 5000, 7 days));
        vm.prank(creator);
        vault.setReviewer(reviewer, true);
        h = new VaultHandler(usdc, factory, vault, creator, reviewer, feeRouter);
        targetContract(address(h));
    }

    /// Invariant 1: vault balance == unreserved + reserved.
    function invariant_balanceMatchesAccounting() public view {
        assertEq(usdc.balanceOf(address(vault)), vault.unreserved() + vault.reserved());
    }

    /// Conservation: deposits == balance + withdrawn + paid out + fees.
    function invariant_fundsConserved() public view {
        assertEq(
            h.totalDeposited(),
            usdc.balanceOf(address(vault)) + h.totalWithdrawn() + h.totalPaidToContributors() + h.totalPaidFees()
        );
        assertEq(usdc.balanceOf(feeRouter), h.totalPaidFees());
    }

    /// Invariant 2: per task, paid <= reward * max, and non-rejected count <= max.
    function invariant_taskBounds() public view {
        for (uint256 t = 1; t <= vault.taskCount(); ++t) {
            ProjectVault.Task memory tk = vault.getTask(t);
            assertLe(h.paidPerTask(t), tk.reward * tk.maxSubmissions);
            assertLe(tk.active, tk.maxSubmissions);
            assertLe(tk.claimed, tk.active);
            assertLe(tk.reservedUnits, tk.maxSubmissions);
        }
    }

    /// Invariant 3: each submission is paid at most once. Invariant 4 (part): rejected never paid.
    function invariant_paidAtMostOnce_rejectedNeverPaid() public view {
        for (uint256 s = 1; s <= vault.submissionCount(); ++s) {
            assertLe(h.paidCount(s), 1);
            if (h.everRejected(s)) assertFalse(h.everClaimed(s));
        }
    }

    /// Reservation is exactly the sum of per-task reserved units.
    function invariant_reservedMatchesTasks() public view {
        uint256 sum;
        for (uint256 t = 1; t <= vault.taskCount(); ++t) {
            ProjectVault.Task memory tk = vault.getTask(t);
            sum += uint256(tk.reservedUnits) * (tk.reward + tk.feePerSubmission);
        }
        assertEq(sum, vault.reserved());
    }

    /// Invariant 5: reserved always covers every unclaimed pending/approved submission.
    function invariant_pendingAlwaysCovered() public view {
        for (uint256 t = 1; t <= vault.taskCount(); ++t) {
            ProjectVault.Task memory tk = vault.getTask(t);
            assertGe(tk.reservedUnits, tk.active - tk.claimed);
        }
    }

    /// Invariant 9: fee never above 15%.
    function invariant_feeBounded() public view {
        assertLe(factory.feeBps(), 1500);
    }
}
