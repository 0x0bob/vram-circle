// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {FeeRouter} from "../src/fees/FeeRouter.sol";

contract FeeRouterTest is Test {
    MockUSDC usdc;
    FeeRouter router;
    address timelock = makeAddr("timelock");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
        router = new FeeRouter(address(usdc), timelock, treasury);
    }

    function test_constructor_setsState() public view {
        assertEq(address(router.usdc()), address(usdc));
        assertEq(router.timelock(), timelock);
        assertEq(router.treasury(), treasury);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(address(0), timelock, treasury);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(address(usdc), address(0), treasury);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(address(usdc), timelock, address(0));
    }

    function test_distribute_forwardsWholeBalanceToTreasury() public {
        usdc.mint(address(router), 123e6);
        vm.prank(alice); // permissionless
        uint256 sent = router.distribute();
        assertEq(sent, 123e6);
        assertEq(usdc.balanceOf(treasury), 123e6);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_distribute_emptyBalanceIsNoop() public {
        assertEq(router.distribute(), 0);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function testFuzz_distribute_alwaysToTreasury(uint256 amount, address caller) public {
        amount = bound(amount, 0, type(uint128).max);
        usdc.mint(address(router), amount);
        vm.prank(caller);
        router.distribute();
        assertEq(usdc.balanceOf(treasury), amount);
        assertEq(usdc.balanceOf(caller) == 0 || caller == treasury, true);
    }

    function test_distribute_emitsEvent() public {
        usdc.mint(address(router), 5e6);
        vm.expectEmit(true, false, false, true);
        emit FeeRouter.Distributed(treasury, 5e6);
        router.distribute();
    }

    function test_distribute_blacklistedTreasuryRevertsButKeepsFunds() public {
        usdc.mint(address(router), 5e6);
        usdc.setBlacklisted(treasury, true);
        vm.expectRevert();
        router.distribute();
        assertEq(usdc.balanceOf(address(router)), 5e6); // nothing lost; timelock can re-point
        vm.prank(timelock);
        router.setTreasury(alice);
        router.distribute();
        assertEq(usdc.balanceOf(alice), 5e6);
    }

    function test_setTreasury_onlyTimelock() public {
        vm.prank(alice);
        vm.expectRevert(FeeRouter.NotTimelock.selector);
        router.setTreasury(alice);
        vm.prank(timelock);
        router.setTreasury(alice);
        assertEq(router.treasury(), alice);
    }

    function test_setTreasury_zeroReverts() public {
        vm.prank(timelock);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.setTreasury(address(0));
    }

    function test_setTreasury_emitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit FeeRouter.TreasurySet(treasury, alice);
        vm.prank(timelock);
        router.setTreasury(alice);
    }

    /// @dev The router exposes no function that sends USDC anywhere except to `treasury`.
    function test_noArbitraryTransferSurface() public {
        usdc.mint(address(router), 10e6);
        vm.startPrank(alice);
        (bool ok,) = address(router).call(abi.encodeWithSignature("rescue(address,uint256)", alice, 10e6));
        assertFalse(ok);
        (ok,) = address(router).call(abi.encodeWithSignature("withdraw(address,uint256)", alice, 10e6));
        assertFalse(ok);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 0);
    }
}
