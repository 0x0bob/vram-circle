// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Timelock} from "../src/governance/Timelock.sol";
import {FeeRouter} from "../src/fees/FeeRouter.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";

/// @notice Steps 1-2 deploy, in dependency order: Timelock -> FeeRouter -> ProjectFactory.
/// @dev DRY RUN FIRST (no --broadcast) and review the printed plan. Testnet only unless told otherwise.
///      Env:
///        USDC_ADDRESS     required. TODO(verify): Arc USDC address from Circle docs. Never hard-code.
///        TREASURY         treasury multisig; receives fees; proposes/executes timelock operations.
///        GUARDIAN         guardian multisig; may pause, cannot move funds or change params.
///      TREASURY and GUARDIAN fall back to the placeholders below ONLY on a local chain (31337) so a
///      dry run works; on any other chain the script reverts if they are unset.
contract Deploy is Script {
    // TODO(verify): placeholders for local dry runs only. Replace with the real multisigs before any broadcast.
    address internal constant PLACEHOLDER_TREASURY = address(uint160(uint256(keccak256("vram.placeholder.treasury"))));
    address internal constant PLACEHOLDER_GUARDIAN = address(uint160(uint256(keccak256("vram.placeholder.guardian"))));

    uint256 internal constant TIMELOCK_DELAY = 48 hours;
    uint16 internal constant FEE_BPS = 1000;
    uint32 internal constant MIN_REVIEW_PERIOD = 3 days;

    error PlaceholderOnRealChain();

    function run() external returns (Timelock timelock, FeeRouter router, ProjectFactory factory) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = _multisig("TREASURY", PLACEHOLDER_TREASURY);
        address guardian = _multisig("GUARDIAN", PLACEHOLDER_GUARDIAN);

        console.log("== VRAM deploy plan ==");
        console.log("chainid", block.chainid);
        console.log("usdc", usdc);
        console.log("treasury multisig", treasury);
        console.log("guardian multisig", guardian);
        console.log("timelock delay (s)", TIMELOCK_DELAY);
        console.log("fee bps", FEE_BPS);

        vm.startBroadcast();
        (timelock, router, factory) = _deployProtocol(usdc, treasury, guardian);
        vm.stopBroadcast();

        console.log("1. Timelock       ", address(timelock));
        console.log("2. FeeRouter      ", address(router));
        console.log("3. ProjectFactory ", address(factory));
        console.log("   vault impl     ", factory.vaultImplementation());
        // TODO: write deployments/<network>.json and verify all contracts on the Arc explorer after a real broadcast.
    }

    /// @dev Deploys in dependency order. Callers wrap this in their own broadcast.
    function _deployProtocol(address usdc, address treasury, address guardian)
        internal
        returns (Timelock timelock, FeeRouter router, ProjectFactory factory)
    {
        address[] memory ops = new address[](1);
        ops[0] = treasury; // proposer and executor; no external admin (timelock administers itself)
        timelock = new Timelock(TIMELOCK_DELAY, ops, ops);
        router = new FeeRouter(usdc, address(timelock), treasury);
        factory = new ProjectFactory(usdc, address(timelock), guardian, address(router), FEE_BPS, MIN_REVIEW_PERIOD);
    }

    function _multisig(string memory name, address placeholder) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) {
            if (block.chainid != 31337) revert PlaceholderOnRealChain();
            a = placeholder;
        }
    }
}
