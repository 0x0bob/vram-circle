// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title Timelock
/// @notice OpenZeppelin TimelockController with a hard 48h floor on the delay and no external admin.
/// @dev The admin role is held by the timelock itself, so every role or delay change must itself wait
///      out the delay. The effective delay is `max(configured, MIN_DELAY)`: OpenZeppelin's `schedule`
///      reads `getMinDelay()`, so even a (timelocked) `updateDelay` to a lower value cannot shorten it.
contract Timelock is TimelockController {
    uint256 public constant MIN_DELAY = 48 hours;

    error DelayTooShort();

    /// @param minDelay Initial delay, at least 48 hours.
    /// @param proposers Addresses that may schedule and cancel (also given the canceller role).
    /// @param executors Addresses that may execute ready operations (address(0) means anyone).
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0))
    {
        if (minDelay < MIN_DELAY) revert DelayTooShort();
    }

    /// @inheritdoc TimelockController
    function getMinDelay() public view override returns (uint256) {
        uint256 configured = super.getMinDelay();
        return configured < MIN_DELAY ? MIN_DELAY : configured;
    }
}
