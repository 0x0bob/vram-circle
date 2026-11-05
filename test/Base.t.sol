// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";
import {ProjectVault} from "../src/core/ProjectVault.sol";

abstract contract Base is Test {
    MockUSDC internal usdc;
    ProjectFactory internal factory;
    ProjectVault internal vault;

    address internal timelock = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal feeRouter = makeAddr("feeRouter");
    address internal creator = makeAddr("creator");
    address internal reviewer = makeAddr("reviewer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant REWARD = 100e6;
    uint32 internal constant REVIEW = 7 days;

    function setUp() public virtual {
        usdc = new MockUSDC();
        factory = new ProjectFactory(address(usdc), timelock, guardian, feeRouter, 1000, 3 days);
        vm.prank(creator);
        vault = ProjectVault(factory.createProject("ipfs://meta", 5000, REVIEW));
        usdc.mint(creator, 1_000_000e6);
        vm.prank(creator);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(creator);
        vault.setReviewer(reviewer, true);
    }

    function _fund(uint256 amount) internal {
        if (usdc.balanceOf(creator) < amount) usdc.mint(creator, amount);
        vm.prank(creator);
        vault.deposit(amount);
    }

    function _params(uint32 max, bool allowlistOnly) internal view returns (ProjectVault.TaskParams memory p) {
        p = ProjectVault.TaskParams({
            reward: REWARD,
            maxSubmissions: max,
            deadline: uint64(block.timestamp + 30 days),
            specHash: keccak256("spec"),
            allowlistOnly: allowlistOnly,
            maxPerContributor: 1
        });
    }

    /// @dev Funds and creates an open task with `max` slots; returns taskId.
    function _task(uint32 max) internal returns (uint256 id) {
        _fund(uint256(REWARD) * 110 / 100 * max);
        vm.prank(creator);
        id = vault.createTask(_params(max, false));
    }

    function _submit(address who, uint256 taskId) internal returns (uint256 id) {
        vm.prank(who);
        id = vault.submit(taskId, keccak256(abi.encode(who, taskId)), "ipfs://x");
    }
}
