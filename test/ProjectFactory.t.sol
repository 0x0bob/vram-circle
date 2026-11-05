// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";
import {ProjectVault} from "../src/core/ProjectVault.sol";

contract ProjectFactoryTest is Base {
    function test_createProject_happy() public view {
        assertEq(vault.creator(), creator);
        assertEq(vault.creatorBps(), 5000);
        assertEq(vault.reviewPeriod(), REVIEW);
        assertEq(factory.projectCount(), 1);
        assertTrue(factory.isProject(address(vault)));
    }

    function test_createProject_reviewPeriodBounds() public {
        vm.startPrank(creator);
        vm.expectRevert(ProjectFactory.BadReviewPeriod.selector);
        factory.createProject("x", 5000, 3 days - 1);
        vm.expectRevert(ProjectFactory.BadReviewPeriod.selector);
        factory.createProject("x", 5000, 30 days + 1);
        factory.createProject("x", 5000, 3 days);
        factory.createProject("x", 5000, 30 days);
        vm.stopPrank();
    }

    function test_createProject_badBps() public {
        vm.prank(creator);
        vm.expectRevert(ProjectFactory.BadBps.selector);
        factory.createProject("x", 10_001, 7 days);
    }

    function test_createProject_pausedBlocks() public {
        vm.prank(guardian);
        factory.pause();
        vm.prank(creator);
        vm.expectRevert(ProjectFactory.IsPaused.selector);
        factory.createProject("x", 5000, 7 days);
        vm.prank(guardian);
        factory.unpause();
        vm.prank(creator);
        factory.createProject("x", 5000, 7 days);
    }

    function test_pause_onlyGuardian() public {
        vm.prank(alice);
        vm.expectRevert(ProjectFactory.NotGuardian.selector);
        factory.pause();
        vm.prank(alice);
        vm.expectRevert(ProjectFactory.NotGuardian.selector);
        factory.unpause();
    }

    function test_params_onlyTimelock() public {
        vm.startPrank(guardian); // guardian cannot change params
        vm.expectRevert(ProjectFactory.NotTimelock.selector);
        factory.setFeeBps(500);
        vm.expectRevert(ProjectFactory.NotTimelock.selector);
        factory.setFeeRouter(alice);
        vm.expectRevert(ProjectFactory.NotTimelock.selector);
        factory.setMinReviewPeriod(2 days);
        vm.expectRevert(ProjectFactory.NotTimelock.selector);
        factory.setGuardian(alice);
        vm.stopPrank();
    }

    function test_setFeeBps_bounded() public {
        vm.startPrank(timelock);
        factory.setFeeBps(1500);
        vm.expectRevert(ProjectFactory.FeeTooHigh.selector);
        factory.setFeeBps(1501);
        vm.stopPrank();
    }

    function testFuzz_setFeeBps(uint16 bps) public {
        vm.prank(timelock);
        if (bps > 1500) vm.expectRevert(ProjectFactory.FeeTooHigh.selector);
        factory.setFeeBps(bps);
        assertLe(factory.feeBps(), 1500);
    }

    function test_setters_happy_andZeroChecks() public {
        vm.startPrank(timelock);
        factory.setFeeRouter(alice);
        assertEq(factory.feeRouter(), alice);
        vm.expectRevert(ProjectFactory.ZeroAddress.selector);
        factory.setFeeRouter(address(0));
        factory.setGuardian(bob);
        assertEq(factory.guardian(), bob);
        vm.expectRevert(ProjectFactory.ZeroAddress.selector);
        factory.setGuardian(address(0));
        factory.setMinReviewPeriod(5 days);
        vm.expectRevert(ProjectFactory.BadReviewPeriod.selector);
        factory.setMinReviewPeriod(31 days);
        vm.stopPrank();
    }

    function test_constructor_validation() public {
        vm.expectRevert(ProjectFactory.FeeTooHigh.selector);
        new ProjectFactory(address(usdc), timelock, guardian, feeRouter, 1501, 3 days);
        vm.expectRevert(ProjectFactory.ZeroAddress.selector);
        new ProjectFactory(address(0), timelock, guardian, feeRouter, 1000, 3 days);
        vm.expectRevert(ProjectFactory.BadReviewPeriod.selector);
        new ProjectFactory(address(usdc), timelock, guardian, feeRouter, 1000, 0);
    }

    function test_newFeeAppliesOnlyToNewTasks() public {
        vm.prank(timelock);
        factory.setFeeBps(500);
        _fund(105e6);
        vm.prank(creator);
        vault.createTask(_params(1, false));
        assertEq(vault.reserved(), 105e6);
    }
}
