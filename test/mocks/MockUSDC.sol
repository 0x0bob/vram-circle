// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only USDC stand-in (6 decimals) with a Circle-style blacklist.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blacklisted;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlacklisted(address a, bool b) external {
        blacklisted[a] = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blacklisted[from] && !blacklisted[to], "blacklisted");
        super._update(from, to, value);
    }
}
