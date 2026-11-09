// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/Script.sol";
import {Deploy} from "./Deploy.s.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {Timelock} from "../src/governance/Timelock.sol";
import {FeeRouter} from "../src/fees/FeeRouter.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";

/// @notice LOCAL DEV ONLY (Anvil). Deploys MockUSDC plus steps 1-2 and mints test USDC to Anvil accounts 1-5.
///         Writes addresses to `deployments/local.json`. Refuses to run on any chain except 31337.
///         Never use for a real network: MockUSDC has an open `mint`.
contract DeployLocal is Deploy {
    error LocalOnly();

    uint256 internal constant MINT_AMOUNT = 100_000e6;

    function runLocal() external {
        if (block.chainid != 31337) revert LocalOnly();

        // Anvil default accounts: 8 = treasury multisig, 9 = guardian multisig (well-known test keys).
        address treasury = vm.addr(0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6);
        address guardian = vm.addr(0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897);

        vm.startBroadcast();
        MockUSDC usdc = new MockUSDC();
        (Timelock timelock, FeeRouter router, ProjectFactory factory) =
            _deployProtocol(address(usdc), treasury, guardian);
        // Anvil accounts 1-5 (creator, reviewer, contributors).
        address[5] memory users = [
            0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
            0x90F79bf6EB2c4f870365E785982E1f101E93b906,
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,
            0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
        ];
        for (uint256 i; i < users.length; ++i) {
            usdc.mint(users[i], MINT_AMOUNT);
        }
        vm.stopBroadcast();

        string memory k = "local";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "usdc", address(usdc));
        vm.serializeAddress(k, "timelock", address(timelock));
        vm.serializeAddress(k, "feeRouter", address(router));
        vm.serializeUint(k, "deployBlock", block.number);
        string memory json = vm.serializeAddress(k, "factory", address(factory));
        vm.writeJson(json, "deployments/local.json");
        console.log("MockUSDC", address(usdc));
        console.log("ProjectFactory", address(factory));
    }
}
