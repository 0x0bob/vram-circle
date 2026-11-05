// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {ProjectVault} from "../src/core/ProjectVault.sol";

contract ProjectVaultTest is Base {
    // ------------------------------------------------------------ deposit/withdraw

    function test_deposit_happy() public {
        _fund(500e6);
        assertEq(vault.unreserved(), 500e6);
        assertEq(usdc.balanceOf(address(vault)), 500e6);
    }

    function test_deposit_anyoneCanFund() public {
        usdc.mint(alice, 10e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 10e6);
        vault.deposit(10e6);
        vm.stopPrank();
        assertEq(vault.unreserved(), 10e6);
    }

    function test_deposit_revertsZero() public {
        vm.prank(creator);
        vm.expectRevert(ProjectVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_withdrawUnreserved_happy() public {
        _fund(500e6);
        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        vault.withdrawUnreserved(200e6);
        assertEq(usdc.balanceOf(creator) - before, 200e6);
        assertEq(vault.unreserved(), 300e6);
    }

    function test_withdrawUnreserved_reverts() public {
        _fund(500e6);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotCreator.selector);
        vault.withdrawUnreserved(1);
        vm.startPrank(creator);
        vm.expectRevert(ProjectVault.InsufficientUnreserved.selector);
        vault.withdrawUnreserved(500e6 + 1);
        vm.expectRevert(ProjectVault.ZeroAmount.selector);
        vault.withdrawUnreserved(0);
        vm.stopPrank();
    }

    function testFuzz_withdrawNeverExceedsUnreserved(uint256 dep, uint256 wd) public {
        dep = bound(dep, 1, 1_000_000e6);
        _fund(dep);
        wd = bound(wd, 1, dep * 2);
        vm.prank(creator);
        if (wd > dep) vm.expectRevert(ProjectVault.InsufficientUnreserved.selector);
        vault.withdrawUnreserved(wd);
        assertEq(usdc.balanceOf(address(vault)), vault.unreserved() + vault.reserved());
    }

    // ------------------------------------------------------------------ createTask

    function test_createTask_reservesRewardPlusFee() public {
        _fund(1100e6);
        vm.prank(creator);
        uint256 id = vault.createTask(_params(10, false));
        assertEq(id, 1);
        assertEq(vault.reserved(), 1100e6); // 10 * (100 + 10)
        assertEq(vault.unreserved(), 0);
    }

    function test_createTask_revertsUnderfunded() public {
        _fund(1100e6 - 1);
        vm.prank(creator);
        vm.expectRevert(ProjectVault.InsufficientUnreserved.selector);
        vault.createTask(_params(10, false));
    }

    function test_createTask_revertsBadParams() public {
        _fund(1e9);
        ProjectVault.TaskParams memory p = _params(10, false);
        vm.startPrank(creator);
        p.reward = 0;
        vm.expectRevert(ProjectVault.BadParams.selector);
        vault.createTask(p);
        p = _params(0, false);
        vm.expectRevert(ProjectVault.BadParams.selector);
        vault.createTask(p);
        p = _params(10, false);
        p.maxPerContributor = 0;
        vm.expectRevert(ProjectVault.BadParams.selector);
        vault.createTask(p);
        p = _params(10, false);
        p.deadline = uint64(block.timestamp);
        vm.expectRevert(ProjectVault.BadParams.selector);
        vault.createTask(p);
        vm.stopPrank();
    }

    function test_createTask_onlyCreator() public {
        vm.prank(reviewer);
        vm.expectRevert(ProjectVault.NotCreator.selector);
        vault.createTask(_params(1, false));
    }

    function test_createTask_blockedWhenPaused() public {
        _fund(1e9);
        vm.prank(guardian);
        factory.pause();
        vm.prank(creator);
        vm.expectRevert(ProjectVault.IsPaused.selector);
        vault.createTask(_params(1, false));
    }

    function testFuzz_createTask_reservation(uint256 reward, uint32 max) public {
        reward = bound(reward, 1, 1e12);
        max = uint32(bound(max, 1, 1000));
        uint256 fee = reward * 1000 / 10_000;
        uint256 total = (reward + fee) * max;
        _fund(total);
        ProjectVault.TaskParams memory p = _params(max, false);
        p.reward = reward;
        vm.prank(creator);
        vault.createTask(p);
        assertEq(vault.reserved(), total);
        assertEq(vault.unreserved(), 0);
    }

    // ------------------------------------------------------------------- submit

    function test_submit_happy() public {
        uint256 t = _task(2);
        uint256 s = _submit(alice, t);
        assertEq(s, 1);
        assertEq(vault.getSubmission(s).contributor, alice);
        assertEq(uint8(vault.getSubmission(s).status), uint8(ProjectVault.Status.Submitted));
    }

    function test_submit_revertsUnknownTask() public {
        vm.prank(alice);
        vm.expectRevert(ProjectVault.UnknownTask.selector);
        vault.submit(1, bytes32(0), "");
    }

    function test_submit_revertsFull() public {
        uint256 t = _task(1);
        _submit(alice, t);
        vm.prank(bob);
        vm.expectRevert(ProjectVault.TaskFull.selector);
        vault.submit(t, bytes32(0), "");
    }

    function test_submit_revertsPerContributorLimit() public {
        uint256 t = _task(5);
        _submit(alice, t);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.ContributorLimit.selector);
        vault.submit(t, bytes32(0), "");
    }

    function test_submit_revertsAfterDeadline() public {
        uint256 t = _task(2);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.TaskPastDeadline.selector);
        vault.submit(t, bytes32(0), "");
    }

    function test_submit_revertsClosed() public {
        uint256 t = _task(2);
        vm.prank(creator);
        vault.closeTask(t);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.TaskClosedError.selector);
        vault.submit(t, bytes32(0), "");
    }

    function test_submit_revertsWhenPaused() public {
        uint256 t = _task(2);
        vm.prank(guardian);
        factory.pause();
        vm.prank(alice);
        vm.expectRevert(ProjectVault.IsPaused.selector);
        vault.submit(t, bytes32(0), "");
    }

    function test_allowlist_flow() public {
        _fund(1100e6);
        vm.prank(creator);
        uint256 t = vault.createTask(_params(10, true));
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotAllowlisted.selector);
        vault.submit(t, bytes32(0), "");

        address[] memory a = new address[](1);
        a[0] = alice;
        vm.prank(creator);
        vault.setAllowlist(t, a, true);
        _submit(alice, t);

        vm.prank(bob);
        vm.expectRevert(ProjectVault.NotAllowlisted.selector);
        vault.submit(t, bytes32(0), "");
        vm.prank(creator);
        vault.openTask(t);
        _submit(bob, t);

        vm.prank(creator);
        vm.expectRevert(ProjectVault.AlreadyOpen.selector);
        vault.openTask(t);
    }

    function test_allowlist_onlyCreator() public {
        address[] memory a = new address[](1);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotCreator.selector);
        vault.setAllowlist(1, a, true);
    }

    // ---------------------------------------------------------- approve / reject

    function test_approveAndClaim_paysRewardAndFee() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(reviewer);
        vault.approve(s);
        vm.prank(alice);
        vault.claim(s);
        assertEq(usdc.balanceOf(alice), REWARD);
        assertEq(usdc.balanceOf(feeRouter), 10e6);
        assertEq(vault.reserved(), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_approve_reverts() public {
        uint256 t = _task(2);
        uint256 s = _submit(alice, t);
        vm.prank(bob);
        vm.expectRevert(ProjectVault.NotReviewerOrCreator.selector);
        vault.approve(s);
        vm.prank(creator);
        vm.expectRevert(ProjectVault.UnknownSubmission.selector);
        vault.approve(99);
        vm.prank(creator);
        vault.approve(s);
        vm.prank(creator);
        vm.expectRevert(ProjectVault.NotSubmitted.selector);
        vault.approve(s);
    }

    function test_approve_revertsAfterReviewWindow() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.warp(block.timestamp + REVIEW);
        vm.prank(creator);
        vm.expectRevert(ProjectVault.ReviewWindowClosed.selector);
        vault.approve(s);
        vm.prank(creator);
        vm.expectRevert(ProjectVault.ReviewWindowClosed.selector);
        vault.reject(s, keccak256("r"));
    }

    function test_reject_requiresReason() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(reviewer);
        vm.expectRevert(ProjectVault.ReasonRequired.selector);
        vault.reject(s, bytes32(0));
    }

    function test_reject_onlyReviewerOrCreator() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotReviewerOrCreator.selector);
        vault.reject(s, keccak256("r"));
    }

    function test_reject_blocksClaim_andFreesSlot() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(reviewer);
        vault.reject(s, keccak256("bad"));
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotClaimable.selector);
        vault.claim(s);
        // slot is free again, reservation is intact
        assertEq(vault.reserved(), 110e6);
        _submit(bob, t);
    }

    function test_reject_afterClose_releasesReservation() public {
        uint256 t = _task(2);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.closeTask(t);
        assertEq(vault.reserved(), 110e6); // only alice's unit
        vm.prank(creator);
        vault.reject(s, keccak256("bad"));
        assertEq(vault.reserved(), 0);
        assertEq(vault.unreserved(), 220e6);
    }

    function test_removedReviewerLosesPower() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.setReviewer(reviewer, false);
        vm.prank(reviewer);
        vm.expectRevert(ProjectVault.NotReviewerOrCreator.selector);
        vault.approve(s);
    }

    // -------------------------------------------------------------------- claim

    function test_claim_autoApprovedAfterReviewPeriod() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotClaimable.selector);
        vault.claim(s);
        vm.warp(block.timestamp + REVIEW);
        vm.expectEmit(true, true, true, false);
        emit ProjectVault.AutoApproved(t, s, alice);
        vm.prank(alice);
        vault.claim(s);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_claim_onlyContributor() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.approve(s);
        vm.prank(bob);
        vm.expectRevert(ProjectVault.NotContributor.selector);
        vault.claim(s);
        vm.prank(creator);
        vm.expectRevert(ProjectVault.NotContributor.selector);
        vault.claim(s);
    }

    function test_claim_onlyOnce() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.approve(s);
        vm.prank(alice);
        vault.claim(s);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotClaimable.selector);
        vault.claim(s);
    }

    function test_claim_unknown() public {
        vm.prank(alice);
        vm.expectRevert(ProjectVault.UnknownSubmission.selector);
        vault.claim(1);
    }

    function test_claim_worksWhilePaused() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.approve(s);
        vm.prank(guardian);
        factory.pause();
        vm.prank(alice);
        vault.claim(s);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_blacklistedContributorDoesNotBlockOthers() public {
        uint256 t = _task(2);
        uint256 s1 = _submit(alice, t);
        uint256 s2 = _submit(bob, t);
        vm.startPrank(creator);
        vault.approve(s1);
        vault.approve(s2);
        vm.stopPrank();
        usdc.setBlacklisted(alice, true);
        vm.prank(alice);
        vm.expectRevert();
        vault.claim(s1);
        vm.prank(bob);
        vault.claim(s2);
        assertEq(usdc.balanceOf(bob), REWARD);
    }

    function test_feeSnapshotSurvivesFeeChange() public {
        uint256 t = _task(1);
        uint256 s = _submit(alice, t);
        vm.prank(timelock);
        factory.setFeeBps(1500);
        vm.prank(creator);
        vault.approve(s);
        vm.prank(alice);
        vault.claim(s);
        assertEq(usdc.balanceOf(feeRouter), 10e6); // 10% snapshot, not 15%
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testFuzz_claimPaysExactly(uint256 reward, uint16 feeBps) public {
        reward = bound(reward, 1, 1e12);
        feeBps = uint16(bound(feeBps, 0, 1500));
        vm.prank(timelock);
        factory.setFeeBps(feeBps);
        uint256 fee = reward * feeBps / 10_000;
        _fund(reward + fee);
        ProjectVault.TaskParams memory p = _params(1, false);
        p.reward = reward;
        vm.prank(creator);
        uint256 t = vault.createTask(p);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.approve(s);
        vm.prank(alice);
        vault.claim(s);
        assertEq(usdc.balanceOf(alice), reward);
        assertEq(usdc.balanceOf(feeRouter), fee);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    // --------------------------------------------------------------------- close

    function test_closeTask_releasesUnused() public {
        uint256 t = _task(5);
        _submit(alice, t);
        vm.prank(creator);
        vault.closeTask(t);
        assertEq(vault.reserved(), 110e6);
        assertEq(vault.unreserved(), 440e6);
        vm.prank(creator);
        vault.withdrawUnreserved(440e6);
    }

    function test_closeTask_reverts() public {
        uint256 t = _task(1);
        vm.prank(alice);
        vm.expectRevert(ProjectVault.NotCreator.selector);
        vault.closeTask(t);
        vm.startPrank(creator);
        vault.closeTask(t);
        vm.expectRevert(ProjectVault.AlreadyClosed.selector);
        vault.closeTask(t);
        vm.expectRevert(ProjectVault.UnknownTask.selector);
        vault.closeTask(9);
        vm.stopPrank();
    }

    function test_closeTask_pendingKeepsReservationAndCanAutoApprove() public {
        uint256 t = _task(2);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.closeTask(t);
        vm.warp(block.timestamp + REVIEW);
        vm.prank(alice);
        vault.claim(s);
        assertEq(usdc.balanceOf(alice), REWARD);
        assertEq(vault.reserved(), 0);
        assertEq(usdc.balanceOf(address(vault)), vault.unreserved());
    }

    function test_closeWorksWhilePaused() public {
        uint256 t = _task(1);
        vm.prank(guardian);
        factory.pause();
        vm.prank(creator);
        vault.closeTask(t);
        vm.prank(creator);
        vault.withdrawUnreserved(110e6);
    }

    // ------------------------------------------------------------------ init

    function test_initializeOnlyOnce() public {
        vm.expectRevert();
        vault.initialize(alice, address(factory), address(usdc), 5000, REVIEW, "x");
    }

    function test_implementationLocked() public {
        ProjectVault impl = ProjectVault(factory.vaultImplementation());
        vm.expectRevert();
        impl.initialize(alice, address(factory), address(usdc), 5000, REVIEW, "x");
    }
}
