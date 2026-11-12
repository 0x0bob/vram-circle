// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FeeRouter
/// @notice Receives protocol fees in USDC and forwards them to the treasury.
/// @dev `distribute()` is permissionless and can only ever send to `treasury`. The treasury address
///      changes only through the timelock. There is no other way to move funds out. Vaults read this
///      router's address from the factory, so a later version (buyback and burn) can replace it
///      without touching vaults.
contract FeeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable timelock;
    address public treasury;

    event Distributed(address indexed treasury, uint256 amount);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);

    error ZeroAddress();
    error NotTimelock();

    constructor(address usdc_, address timelock_, address treasury_) {
        if (usdc_ == address(0) || timelock_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        timelock = timelock_;
        treasury = treasury_;
    }

    /// @notice Forward the whole USDC balance to the treasury. Anyone may call; a keeper does in practice.
    /// @return amount Amount forwarded (zero when the router is empty).
    function distribute() external nonReentrant returns (uint256 amount) {
        amount = usdc.balanceOf(address(this));
        // Safe: a zero balance only skips a no-op transfer; a 1-wei donation is simply forwarded.
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return 0;
        address to = treasury;
        usdc.safeTransfer(to, amount);
        emit Distributed(to, amount);
    }

    /// @notice Change the treasury. Timelock only (48h delay).
    function setTreasury(address newTreasury) external {
        if (msg.sender != timelock) revert NotTimelock();
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }
}
