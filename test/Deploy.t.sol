// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @dev Exposes Deploy's internal guards. No broadcast happens in these tests.
contract DeployHarness is Deploy {
    function usdcFor(uint256 chainId, address localUsdc) external pure returns (address) {
        return _usdcFor(chainId, localUsdc);
    }

    function checkOperators(address treasury, address guardian) external pure {
        _checkOperators(treasury, guardian);
    }

    function networkName(uint256 chainId) external pure returns (string memory) {
        return _networkName(chainId);
    }

    function write(string calldata path, uint256 deployBlock, address[7] calldata a) external {
        _writeDeployment(path, deployBlock, a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
    }
}

contract DeployTest is Test {
    DeployHarness internal d;

    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function setUp() public {
        d = new DeployHarness();
    }

    function test_mainnetIsBlocked() public {
        vm.expectRevert(Deploy.MainnetBlocked.selector);
        d.usdcFor(5042, address(0));
    }

    function test_unsupportedChainsRevert() public {
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 1));
        d.usdcFor(1, address(0));
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 0));
        d.usdcFor(0, address(0));
    }

    function testFuzz_onlyKnownChainsAreAccepted(uint256 chainId) public {
        vm.assume(chainId != 31337 && chainId != 5042002);
        vm.expectRevert();
        d.usdcFor(chainId, address(0));
    }

    function test_arcTestnetUsesTheVerifiedUsdcAndIgnoresTheLocalOne() public {
        // whatever local USDC is passed in, Arc testnet always gets the verified address
        assertEq(d.usdcFor(5042002, address(0xdEaD)), ARC_TESTNET_USDC);
    }

    function test_localChainUsesTheGivenUsdc() public {
        assertEq(d.usdcFor(31337, address(0xbEEF)), address(0xbEEF));
    }

    function test_treasuryAndGuardianMustBeDistinctAndNonZero() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        d.checkOperators(a, b); // ok

        vm.expectRevert(Deploy.SameOperator.selector);
        d.checkOperators(a, a);
        vm.expectRevert(Deploy.ZeroOperator.selector);
        d.checkOperators(address(0), b);
        vm.expectRevert(Deploy.ZeroOperator.selector);
        d.checkOperators(a, address(0));
    }

    function test_networkNames() public view {
        assertEq(d.networkName(5042002), "arc-testnet");
    }

    function test_writesTheDeploymentFile() public {
        string memory path = "deployments/test-deploy-output.json";
        address[7] memory a = [
            ARC_TESTNET_USDC,
            address(0x1111),
            address(0x2222),
            address(0x3333),
            address(0x4444),
            address(0x5555),
            address(0x6666)
        ];
        d.write(path, 123_456, a);

        string memory json = vm.readFile(path);
        assertEq(vm.parseJsonUint(json, ".chainId"), block.chainid);
        assertEq(vm.parseJsonUint(json, ".deployBlock"), 123_456);
        assertEq(vm.parseJsonAddress(json, ".usdc"), ARC_TESTNET_USDC);
        assertEq(vm.parseJsonAddress(json, ".timelock"), address(0x1111));
        assertEq(vm.parseJsonAddress(json, ".feeRouter"), address(0x2222));
        assertEq(vm.parseJsonAddress(json, ".factory"), address(0x3333));
        assertEq(vm.parseJsonAddress(json, ".vaultImplementation"), address(0x4444));
        assertEq(vm.parseJsonAddress(json, ".treasury"), address(0x5555));
        assertEq(vm.parseJsonAddress(json, ".guardian"), address(0x6666));
        vm.removeFile(path);
    }
}
