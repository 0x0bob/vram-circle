// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";

/// @notice TEST-ONLY stand-in for the Arc system precompiles that the real USDC token calls.
/// @dev Foundry's local EVM does not implement Arc precompiles, so a fork test that touches the real USDC reverts
///      with StackUnderflow inside them. The two entry points below are inferred from the call trace of the real
///      token on Arc testnet (not from documentation), so this is an approximation:
///        0x1800...0000  transfer(address from, address to, uint256 amount18)  moves NATIVE balance (18 decimals)
///        0x1800...0001  isBlocklisted(address) -> bool
///      Everything else (the USDC proxy, its implementation bytecode, its storage) is the real on-chain code.
///      The authoritative check of real-USDC behaviour is the testnet smoke test (docs/testnet-smoke.md).
contract ArcPrecompileEmu {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error InsufficientNative();

    function transfer(address from, address to, uint256 amount18) external returns (bool) {
        if (from.balance < amount18) revert InsufficientNative();
        vm.deal(from, from.balance - amount18);
        vm.deal(to, to.balance + amount18);
        return true;
    }

    function isBlocklisted(address) external pure returns (bool) {
        return false;
    }
}
