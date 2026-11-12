import { isHex, keccak256, toBytes, type Hex } from 'viem'

/** keccak256 of UTF-8 text, computed in the browser (spec text, content and rejection reasons). */
export function hashText(text: string): Hex {
  return keccak256(toBytes(text))
}

export function isBytes32(v: string): v is Hex {
  return isHex(v, { strict: true }) && v.length === 66
}
