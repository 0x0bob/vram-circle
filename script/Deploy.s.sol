// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {Timelock} from "../src/governance/Timelock.sol";
import {FeeRouter} from "../src/fees/FeeRouter.sol";
import {ProjectFactory} from "../src/core/ProjectFactory.sol";

/// @notice Steps 1-2 deploy, in dependency order: Timelock -> FeeRouter -> ProjectFactory.
/// @dev DRY RUN FIRST (no --broadcast) and review the printed plan. TESTNET ONLY: Arc mainnet (5042) is blocked.
///
///      Keys: never in a file or env var. Broadcast with a Foundry encrypted keystore:
///        cast wallet import vram-deployer --interactive
///        forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_TESTNET_RPC_URL --account vram-deployer --broadcast
///
///      Env:
///        TREASURY   receives fees; sole proposer/executor on the timelock. Required off-chain-local.
///        GUARDIAN   may pause, cannot move funds or change params. Must differ from TREASURY.
///        USDC_ADDRESS  used on the local chain only. On Arc testnet the verified USDC is pinned below.
///      TREASURY and GUARDIAN fall back to placeholders ONLY on the local chain (31337).
///      Real multisigs are required before mainnet (see CLAUDE.md section 11). On testnet these are plain wallets.
contract Deploy is Script {
    // Source: docs.arc.io (Arc network details), as verified by the project owner, Nov 2026. ERC-20 interface, 6 decimals.
    // Arc testnet chain id 5042002. Mainnet (5042) is deliberately NOT supported here.
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    // Local dry runs only. On any other chain TREASURY and GUARDIAN must be set.
    address internal constant PLACEHOLDER_TREASURY = address(uint160(uint256(keccak256("vram.placeholder.treasury"))));
    address internal constant PLACEHOLDER_GUARDIAN = address(uint160(uint256(keccak256("vram.placeholder.guardian"))));

    uint256 internal constant TIMELOCK_DELAY = 48 hours;
    uint16 internal constant FEE_BPS = 1000;
    uint32 internal constant MIN_REVIEW_PERIOD = 3 days;

    error PlaceholderOnRealChain();
    error MainnetBlocked();
    error UnsupportedChain(uint256 chainId);
    error SameOperator();
    error ZeroOperator();

    function run() external returns (Timelock timelock, FeeRouter router, ProjectFactory factory) {
        address usdc =
            _usdcFor(block.chainid, block.chainid == LOCAL_CHAIN_ID ? vm.envAddress("USDC_ADDRESS") : address(0));
        address treasury = _multisig("TREASURY", PLACEHOLDER_TREASURY);
        address guardian = _multisig("GUARDIAN", PLACEHOLDER_GUARDIAN);
        _checkOperators(treasury, guardian);
        uint256 startBlock = block.number; // lower bound of the deploy block; the event scan starts here

        console.log("== VRAM deploy plan ==");
        console.log("network", _networkName(block.chainid));
        console.log("chainid", block.chainid);
        console.log("usdc (ERC-20, 6 decimals)", usdc);
        console.log("treasury", treasury);
        console.log("guardian", guardian);
        console.log("timelock delay (s)", TIMELOCK_DELAY);
        console.log("fee bps", FEE_BPS);
        console.log("min review period (s)", MIN_REVIEW_PERIOD);

        vm.startBroadcast();
        (timelock, router, factory) = _deployProtocol(usdc, treasury, guardian);
        vm.stopBroadcast();

        console.log("1. Timelock       ", address(timelock));
        console.log("2. FeeRouter      ", address(router));
        console.log("3. ProjectFactory ", address(factory));
        console.log("   vault impl     ", factory.vaultImplementation());

        // Only a real broadcast writes the record; a dry run must never leave addresses that do not exist.
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && block.chainid == ARC_TESTNET_CHAIN_ID) {
            _writeDeployment(
                string.concat("deployments/", _networkName(block.chainid), ".json"),
                startBlock,
                usdc,
                address(timelock),
                address(router),
                address(factory),
                factory.vaultImplementation(),
                treasury,
                guardian
            );
        }
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

    /// @dev Mainnet is blocked outright. Arc testnet pins the verified USDC and ignores the environment.
    function _usdcFor(uint256 chainId, address localUsdc) internal pure returns (address) {
        if (chainId == ARC_MAINNET_CHAIN_ID) revert MainnetBlocked();
        if (chainId == ARC_TESTNET_CHAIN_ID) return ARC_TESTNET_USDC;
        if (chainId == LOCAL_CHAIN_ID) return localUsdc;
        revert UnsupportedChain(chainId);
    }

    function _networkName(uint256 chainId) internal pure returns (string memory) {
        if (chainId == ARC_TESTNET_CHAIN_ID) return "arc-testnet";
        if (chainId == LOCAL_CHAIN_ID) return "local";
        revert UnsupportedChain(chainId);
    }

    /// @dev Treasury and guardian are separate trust roles: one key must never hold both.
    function _checkOperators(address treasury, address guardian) internal pure {
        if (treasury == address(0) || guardian == address(0)) revert ZeroOperator();
        if (treasury == guardian) revert SameOperator();
    }

    function _writeDeployment(
        string memory path,
        uint256 deployBlock,
        address usdc,
        address timelock,
        address router,
        address factory,
        address vaultImplementation,
        address treasury,
        address guardian
    ) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", deployBlock);
        vm.serializeAddress(k, "usdc", usdc);
        vm.serializeAddress(k, "timelock", timelock);
        vm.serializeAddress(k, "feeRouter", router);
        vm.serializeAddress(k, "vaultImplementation", vaultImplementation);
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "guardian", guardian);
        string memory json = vm.serializeAddress(k, "factory", factory);
        vm.writeJson(json, path);
    }

    function _multisig(string memory name, address placeholder) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) {
            if (block.chainid != LOCAL_CHAIN_ID) revert PlaceholderOnRealChain();
            a = placeholder;
        }
    }
}
