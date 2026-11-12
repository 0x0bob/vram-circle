// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {Timelock} from "../../src/governance/Timelock.sol";
import {FeeRouter} from "../../src/fees/FeeRouter.sol";
import {ProjectFactory} from "../../src/core/ProjectFactory.sol";
import {ProjectVault} from "../../src/core/ProjectVault.sol";
import {ArcPrecompileEmu} from "./ArcPrecompileEmu.sol";

/// @notice Runs the core flow against the REAL USDC contract on a fork of Arc testnet.
/// @dev Skipped unless ARC_TESTNET_RPC_URL is set (so CI without the variable stays green). Run locally with:
///        ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io forge test --match-path "test/fork/*" -vvv
///      The USDC address and chain id come from Deploy.s.sol (docs.arc.io, verified by the project owner,
///      Nov 2026). Only the ERC-20 interface (6 decimals) is used here, never the 18-decimal native balance.
contract ArcForkTest is Test, Deploy {
    IERC20Metadata internal usdc = IERC20Metadata(ARC_TESTNET_USDC);
    Timelock internal timelock;
    FeeRouter internal router;
    ProjectFactory internal factory;
    ProjectVault internal vault;

    address internal treasury = makeAddr("treasury");
    address internal guardian = makeAddr("guardian");
    address internal creator = makeAddr("creator");
    address internal reviewer = makeAddr("reviewer");
    address internal alice = makeAddr("alice");

    uint256 internal constant REWARD = 100e6;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true); // approved: skip when no RPC is configured
        vm.createSelectFork(rpc);
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "not Arc testnet");

        // Foundry's local EVM does not run Arc's system precompiles. See _mockArcPrecompiles.
        _mockArcPrecompiles();

        (timelock, router, factory) = _deployProtocol(ARC_TESTNET_USDC, treasury, guardian);
    }

    address internal constant ARC_NATIVE_TRANSFER = 0x1800000000000000000000000000000000000000;
    address internal constant ARC_BLOCKLIST = 0x1800000000000000000000000000000000000001;

    /// @dev Foundry cannot run Arc's system precompiles, which the real USDC calls on every transfer. Etch a
    ///      test-only emulator at both addresses (see ArcPrecompileEmu for what is approximated).
    function _mockArcPrecompiles() internal {
        address emu = address(new ArcPrecompileEmu());
        vm.etch(ARC_NATIVE_TRANSFER, emu.code);
        vm.etch(ARC_BLOCKLIST, emu.code);
        vm.allowCheatcodes(ARC_NATIVE_TRANSFER); // the emulator moves native balances with vm.deal
    }

    /// @dev On Arc the ERC-20 USDC balance IS the native balance scaled from 18 to 6 decimals (verified on testnet:
    ///      balanceOf(x) == x.balance / 1e12). So a test wallet is funded with vm.deal in 18-decimal native units,
    ///      and the 6-decimal ERC-20 view is asserted to match. Never mix the two units elsewhere.
    function _fundCreator(uint256 amount6) internal {
        vm.deal(creator, amount6 * 1e12);
        assertEq(usdc.balanceOf(creator), amount6, "ERC-20 view must equal native / 1e12");
    }

    function test_fork_usdcIsTheExpectedToken() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.symbol(), "USDC");
    }

    function test_fork_coreFlow_createDepositTaskSubmitApproveClaim() public {
        _fundCreator(1_000e6);

        // create project
        vm.prank(creator);
        vault = ProjectVault(factory.createProject("ipfs://fork-test", 5000, 7 days));
        assertTrue(factory.isProject(address(vault)));

        // deposit: real USDC, so approve first
        vm.startPrank(creator);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(500e6);
        vault.setReviewer(reviewer, true);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), 500e6);

        // task: reward 100 net, fee 10 on top, 2 slots -> reserves 220
        vm.prank(creator);
        uint256 taskId = vault.createTask(
            ProjectVault.TaskParams({
                reward: REWARD,
                maxSubmissions: 2,
                deadline: uint64(block.timestamp + 30 days),
                specHash: keccak256("spec"),
                allowlistOnly: false,
                maxPerContributor: 1
            })
        );
        assertEq(vault.reserved(), 220e6);
        assertEq(vault.unreserved(), 280e6);

        // submit, approve
        vm.prank(alice);
        uint256 subId = vault.submit(taskId, keccak256("answer"), "ipfs://answer");
        vm.prank(reviewer);
        vault.approve(subId);

        // claim: contributor gets the full reward, the router gets the fee on top
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 routerBefore = usdc.balanceOf(address(router));
        vm.prank(alice);
        vault.claim(subId);
        assertEq(usdc.balanceOf(alice) - aliceBefore, REWARD, "contributor gets the full reward");
        assertEq(usdc.balanceOf(address(router)) - routerBefore, 10e6, "fee is 10% on top");

        // conservation: vault USDC == unreserved + reserved
        assertEq(usdc.balanceOf(address(vault)), vault.unreserved() + vault.reserved());

        // fees reach the treasury via the permissionless distribute()
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        router.distribute();
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10e6);

        // creator exits unspent money: close frees the unused slot, then withdraw
        vm.startPrank(creator);
        vault.closeTask(taskId);
        uint256 free = vault.unreserved();
        vault.withdrawUnreserved(free);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.reserved(), 0);
    }

    function test_fork_autoApproveAfterReviewPeriod() public {
        _fundCreator(1_000e6);
        vm.prank(creator);
        vault = ProjectVault(factory.createProject("ipfs://fork-test", 5000, 7 days));
        vm.startPrank(creator);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(200e6);
        uint256 taskId = vault.createTask(
            ProjectVault.TaskParams({
                reward: REWARD,
                maxSubmissions: 1,
                deadline: uint64(block.timestamp + 30 days),
                specHash: keccak256("spec"),
                allowlistOnly: false,
                maxPerContributor: 1
            })
        );
        vm.stopPrank();

        vm.prank(alice);
        uint256 subId = vault.submit(taskId, keccak256("answer"), "ipfs://answer");

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        vault.claim(subId);
        assertEq(usdc.balanceOf(alice), REWARD);
    }
}
