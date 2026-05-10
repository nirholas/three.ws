#!/usr/bin/env bash
# Contract verification script for ThreeWSFactory + ThreeWSPayments
# Usage: BASESCAN_API_KEY=xxx ARBISCAN_API_KEY=xxx bash verify.sh
set -euo pipefail

BASESCAN_KEY="${BASESCAN_API_KEY:?Need BASESCAN_API_KEY}"
ARBISCAN_KEY="${ARBISCAN_API_KEY:?Need ARBISCAN_API_KEY}"

FACTORY_SRC='// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ThreeWSFactory {
    event Deployed(address indexed addr, bytes32 indexed salt);

    function deploy(bytes32 salt, bytes memory initCode) external returns (address addr) {
        assembly {
            addr := create2(0, add(initCode, 32), mload(initCode), salt)
        }
        require(addr != address(0), "deploy failed");
        emit Deployed(addr, salt);
    }

    function predict(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt, initCodeHash
        )))));
    }
}'

PAYMENTS_SRC='// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ThreeWSPayments {
    IERC20 public immutable USDC;
    uint256 public pricePerCall = 1_000;
    address public owner;

    event Payment(address indexed payer, uint256 amount, bytes32 indexed ref);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _usdc) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_usdc == address(0)) revert ZeroAddress();
        owner = _owner;
        USDC = IERC20(_usdc);
    }

    function pay(bytes32 ref) external {
        uint256 amount = pricePerCall;
        USDC.transferFrom(msg.sender, address(this), amount);
        emit Payment(msg.sender, amount, ref);
    }

    function withdraw() external onlyOwner {
        uint256 bal = USDC.balanceOf(address(this));
        USDC.transfer(owner, bal);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        emit PriceUpdated(pricePerCall, newPrice);
        pricePerCall = newPrice;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}'

PAYMENTS_ARGS_BASE="0000000000000000000000004022de2d36c334e73c7a108805cea11c0564f4020000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913"
PAYMENTS_ARGS_ARB="0000000000000000000000004022de2d36c334e73c7a108805cea11c0564f402000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831"

COMPILER="v0.8.35+commit.47b9dedd"
# MIT license type = 3 on Etherscan-style explorers
LICENSE=3

submit() {
  local label="$1"
  local api_url="$2"
  local api_key="$3"
  local address="$4"
  local contract_name="$5"
  local source="$6"
  local ctor_args="$7"

  echo ""
  echo "=== Submitting: $label ==="
  RESPONSE=$(curl -s -X POST "$api_url" \
    --data-urlencode "apikey=$api_key" \
    --data-urlencode "module=contract" \
    --data-urlencode "action=verifysourcecode" \
    --data-urlencode "contractaddress=$address" \
    --data-urlencode "sourceCode=$source" \
    --data-urlencode "codeformat=solidity-single-file" \
    --data-urlencode "contractname=$contract_name" \
    --data-urlencode "compilerversion=$COMPILER" \
    --data-urlencode "optimizationUsed=1" \
    --data-urlencode "runs=200" \
    --data-urlencode "constructorArguements=$ctor_args" \
    --data-urlencode "licenseType=$LICENSE" \
    --data-urlencode "evmversion=")

  echo "Response: $RESPONSE"
  GUID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))" 2>/dev/null || echo "")
  echo "GUID: $GUID"
  echo "$label|$api_url|$api_key|$GUID"
}

check_status() {
  local label="$1"
  local api_url="$2"
  local api_key="$3"
  local guid="$4"

  for i in $(seq 1 12); do
    sleep 10
    RESP=$(curl -s "$api_url?apikey=$api_key&module=contract&action=checkverifystatus&guid=$guid")
    STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))" 2>/dev/null || echo "")
    echo "  [$i] $label: $STATUS"
    if [[ "$STATUS" == "Pass - Verified" ]]; then
      echo "  VERIFIED: $label"
      return 0
    elif [[ "$STATUS" == *"Fail"* ]]; then
      echo "  FAILED: $label — $STATUS"
      return 1
    fi
  done
  echo "  TIMEOUT: $label still pending after 120s"
  return 1
}

# Submit all 4
R1=$(submit "ThreeWSFactory/Base"    "https://api.basescan.org/api"  "$BASESCAN_KEY" "0x00000000D49195AE81759cd247cFeDD9D0B479df" "ThreeWSFactory" "$FACTORY_SRC"  "")
R2=$(submit "ThreeWSPayments/Base"   "https://api.basescan.org/api"  "$BASESCAN_KEY" "0x00000000b43689a688e51a06fCC0e3F2E058720a" "ThreeWSPayments" "$PAYMENTS_SRC" "$PAYMENTS_ARGS_BASE")
R3=$(submit "ThreeWSFactory/Arb"     "https://api.arbiscan.io/api"   "$ARBISCAN_KEY" "0x00000000D49195AE81759cd247cFeDD9D0B479df" "ThreeWSFactory" "$FACTORY_SRC"  "")
R4=$(submit "ThreeWSPayments/Arb"    "https://api.arbiscan.io/api"   "$ARBISCAN_KEY" "0x0000000DEDc7C0C21b0F41dB31CA690DDEEC09C8" "ThreeWSPayments" "$PAYMENTS_SRC" "$PAYMENTS_ARGS_ARB")

echo ""
echo "=== Polling verification status ==="

poll_result() {
  local row="$1"
  local label api_url api_key guid
  IFS='|' read -r label api_url api_key guid <<< "$row"
  [[ -z "$guid" || "$guid" == "0" ]] && { echo "  SKIP (no GUID): $label"; return; }
  check_status "$label" "$api_url" "$api_key" "$guid"
}

poll_result "$R1"
poll_result "$R2"
poll_result "$R3"
poll_result "$R4"

echo ""
echo "=== Done. Check explorers: ==="
echo "  https://basescan.org/address/0x00000000D49195AE81759cd247cFeDD9D0B479df#code"
echo "  https://basescan.org/address/0x00000000b43689a688e51a06fCC0e3F2E058720a#code"
echo "  https://arbiscan.io/address/0x00000000D49195AE81759cd247cFeDD9D0B479df#code"
echo "  https://arbiscan.io/address/0x0000000DEDc7C0C21b0F41dB31CA690DDEEC09C8#code"
