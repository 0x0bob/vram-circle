// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "../Base.t.sol";
import {ProjectVault} from "../../src/core/ProjectVault.sol";

/// @dev Regression tests: never delete. Each documents what broke and when.
contract RegressionTest is Base {
    /// @notice 2026-11-04 (found while designing step 1): if feeBps changed after a task was created,
    ///         using the live fee at claim time would underfund or strand reservation.
    ///         Fee is snapshotted per task so the vault balance always returns to exactly zero.
    function test_regression_feeSnapshotKeepsAccountingExact() public {
        uint256 t = _task(2);
        uint256 s1 = _submit(alice, t);
        uint256 s2 = _submit(bob, t);
        vm.prank(timelock);
        factory.setFeeBps(0);
        vm.startPrank(creator);
        vault.approve(s1);
        vault.approve(s2);
        vm.stopPrank();
        vm.prank(alice);
        vault.claim(s1);
        vm.prank(bob);
        vault.claim(s2);
        assertEq(vault.reserved(), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(feeRouter), 20e6);
    }

    /// @notice 2026-11-04: a contributor must not be able to dodge the per-contributor cap by getting
    ///         rejected then resubmitting beyond the cap; rejection frees exactly one personal slot.
    function test_regression_rejectFreesExactlyOnePersonalSlot() public {
        uint256 t = _task(5);
        uint256 s = _submit(alice, t);
        vm.prank(creator);
        vault.reject(s, keccak256("bad"));
        _submit(alice, t); // allowed: previous was rejected
        vm.prank(alice);
        vm.expectRevert(ProjectVault.ContributorLimit.selector);
        vault.submit(t, bytes32(0), "");
    }

    /// @notice 2026-11-04: after closeTask, claiming an in-flight submission must not release
    ///         reservation belonging to other in-flight submissions (reservedUnits underflow/leak).
    function test_regression_closeThenClaimKeepsOthersReserved() public {
        uint256 t = _task(3);
        uint256 s1 = _submit(alice, t);
        _submit(bob, t);
        vm.prank(creator);
        vault.closeTask(t);
        vm.prank(creator);
        vault.approve(s1);
        vm.prank(alice);
        vault.claim(s1);
        assertEq(vault.reserved(), 110e6); // bob's unit still held
        assertEq(usdc.balanceOf(address(vault)), vault.reserved() + vault.unreserved());
    }
}
