// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only view of the factory used by vault clones.
interface IProjectFactory {
    /// @return Current protocol fee in basis points.
    function feeBps() external view returns (uint16);
    /// @return Address receiving protocol fees.
    function feeRouter() external view returns (address);
    /// @return True while the guardian has paused new projects, tasks and submissions.
    function paused() external view returns (bool);
}
