// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";

/// @notice Step 1 deploy: ProjectFactory (which deploys the vault implementation).
/// @dev Dry run first (no --broadcast) and review the output. Testnet only unless told otherwise.
///      Required env: USDC_ADDRESS, GUARDIAN, TIMELOCK, FEE_ROUTER (all TODO(verify) against Circle docs / step 2).
///      Until the step-2 Timelock exists, TIMELOCK must be a placeholder multisig you control on testnet.
contract Deploy is Script {
    function run() external returns (ProjectFactory factory) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN");
        address timelock = vm.envAddress("TIMELOCK");
        address feeRouter = vm.envAddress("FEE_ROUTER");

        console.log("chainid", block.chainid);
        console.log("usdc", usdc);
        console.log("guardian", guardian);
        console.log("timelock", timelock);
        console.log("feeRouter", feeRouter);

        vm.startBroadcast();
        factory = new ProjectFactory(usdc, timelock, guardian, feeRouter, 1000, 3 days);
        vm.stopBroadcast();

        console.log("ProjectFactory", address(factory));
        console.log("ProjectVault impl", factory.vaultImplementation());
        // TODO: write deployments/<network>.json and verify on the Arc explorer after broadcast.
    }
}
