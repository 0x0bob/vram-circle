import { useWriteContract } from '@wagmi/vue'
import type { Abi, Address, Hash } from 'viem'
import { publicClient } from '../services/chain'
import { useTxStore } from '../stores/tx'
import { useProjectStore } from '../stores/project'

export interface WriteCall {
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

type Writer = (call: WriteCall) => Promise<Hash>

/**
 * Sends wallet-signed transactions. The user signs every one in their own wallet; there is no backend and
 * no key in this app. Each call is tracked in the tx store, then the project is re-read from the chain.
 */
export function useTx() {
  const { mutateAsync } = useWriteContract()
  const tx = useTxStore()
  const project = useProjectStore()
  const write = mutateAsync as unknown as Writer

  /** Resolves true when every call was mined successfully. Calls run in order (e.g. approve, then deposit). */
  async function send(label: string, ...calls: WriteCall[]): Promise<boolean> {
    const ok = await tx.track(label, async (setHash) => {
      for (const call of calls) {
        const hash = await write(call)
        setHash(hash)
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain')
      }
    })
    await project.refresh()
    return ok
  }

  return { send }
}
