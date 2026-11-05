// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Timelock} from "../src/governance/Timelock.sol";
import {FeeRouter} from "../src/fees/FeeRouter.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";

contract TimelockTest is Test {
    MockUSDC usdc;
    Timelock tl;
    FeeRouter router;
    ProjectFactory factory;
    address multisig = makeAddr("multisig");
    address guardian = makeAddr("guardian");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory props = new address[](1);
        props[0] = multisig;
        tl = new Timelock(48 hours, props, props);
        router = new FeeRouter(address(usdc), address(tl), treasury);
        factory = new ProjectFactory(address(usdc), address(tl), guardian, address(router), 1000, 3 days);
    }

    function _schedule(address target, bytes memory data) internal returns (bytes32 salt) {
        salt = keccak256(data);
        vm.prank(multisig);
        tl.schedule(target, 0, data, bytes32(0), salt, 48 hours);
    }

    function test_constructor_rejectsShortDelay() public {
        address[] memory props = new address[](1);
        props[0] = multisig;
        vm.expectRevert(Timelock.DelayTooShort.selector);
        new Timelock(48 hours - 1, props, props);
    }

    function test_noAdminRole() public view {
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), multisig));
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), address(tl))); // self-administered
    }

    function test_feeChange_requires48hDelay() public {
        bytes memory data = abi.encodeCall(ProjectFactory.setFeeBps, (500));
        bytes32 salt = _schedule(address(factory), data);

        vm.prank(multisig);
        vm.expectRevert(); // not ready
        tl.execute(address(factory), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + 48 hours);
        vm.prank(multisig);
        tl.execute(address(factory), 0, data, bytes32(0), salt);
        assertEq(factory.feeBps(), 500);
    }

    function test_factoryParams_directCallByMultisigReverts() public {
        vm.prank(multisig);
        vm.expectRevert(ProjectFactory.NotTimelock.selector);
        factory.setFeeBps(500);
    }

    function test_feeAbove1500_timelockedCallStillReverts() public {
        bytes memory data = abi.encodeCall(ProjectFactory.setFeeBps, (1501));
        bytes32 salt = _schedule(address(factory), data);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(multisig);
        vm.expectRevert();
        tl.execute(address(factory), 0, data, bytes32(0), salt);
        assertEq(factory.feeBps(), 1000);
    }

    function test_treasuryChange_goesThroughTimelock() public {
        bytes memory data = abi.encodeCall(FeeRouter.setTreasury, (alice));
        bytes32 salt = _schedule(address(router), data);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(multisig);
        tl.execute(address(router), 0, data, bytes32(0), salt);
        assertEq(router.treasury(), alice);
    }

    function test_delayCannotBeLoweredBelow48h() public {
        // updateDelay(1h) may execute, but the effective delay stays floored at 48h.
        bytes memory data = abi.encodeWithSignature("updateDelay(uint256)", 1 hours);
        bytes32 salt = _schedule(address(tl), data);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(multisig);
        tl.execute(address(tl), 0, data, bytes32(0), salt);
        assertEq(tl.getMinDelay(), 48 hours);
        bytes memory d2 = abi.encodeCall(ProjectFactory.setFeeBps, (500));
        vm.prank(multisig);
        vm.expectRevert();
        tl.schedule(address(factory), 0, d2, bytes32(0), bytes32(0), 1 hours);
    }

    function test_delayCanBeRaised() public {
        bytes memory data = abi.encodeWithSignature("updateDelay(uint256)", 72 hours);
        bytes32 salt = _schedule(address(tl), data);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(multisig);
        tl.execute(address(tl), 0, data, bytes32(0), salt);
        assertEq(tl.getMinDelay(), 72 hours);
    }

    function test_scheduleBelowMinDelayReverts() public {
        bytes memory data = abi.encodeCall(ProjectFactory.setFeeBps, (500));
        vm.prank(multisig);
        vm.expectRevert();
        tl.schedule(address(factory), 0, data, bytes32(0), bytes32(0), 1 hours);
    }

    function test_onlyProposerCanSchedule() public {
        bytes memory data = abi.encodeCall(ProjectFactory.setFeeBps, (500));
        vm.prank(alice);
        vm.expectRevert();
        tl.schedule(address(factory), 0, data, bytes32(0), bytes32(0), 48 hours);
    }

    function test_guardianCanPauseImmediately_butNotChangeParams() public {
        vm.prank(guardian);
        factory.pause();
        assertTrue(factory.paused());
        vm.prank(guardian);
        vm.expectRevert(ProjectFactory.NotTimelock.selector);
        factory.setFeeBps(0);
    }

    function test_guardianRotation_goesThroughTimelock() public {
        bytes memory data = abi.encodeCall(ProjectFactory.setGuardian, (alice));
        bytes32 salt = _schedule(address(factory), data);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(multisig);
        tl.execute(address(factory), 0, data, bytes32(0), salt);
        assertEq(factory.guardian(), alice);
    }

    function test_distribute_worksWhilePaused() public {
        usdc.mint(address(router), 1e6);
        vm.prank(guardian);
        factory.pause();
        router.distribute();
        assertEq(usdc.balanceOf(treasury), 1e6);
    }
}
