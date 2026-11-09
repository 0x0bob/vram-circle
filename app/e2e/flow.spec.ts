import { test, expect, type Browser, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accounts, anvil, installWallet } from './wallet'

const rpcUrl = process.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'
const shotDir = process.env.SCREENSHOT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'screenshots')
mkdirSync(shotDir, { recursive: true })

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true })
}

/** A browser context (own storage) acting as one wallet user, already connected. */
async function actor(browser: Browser, account: string, path = '/') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await installWallet(context, account, rpcUrl)
  const page = await context.newPage()
  await page.goto(path)
  await page.getByTestId('connect').click()
  await expect(page.getByTestId('account')).toBeVisible()
  return { context, page }
}

const tx = (page: Page) => page.getByTestId('tx-success')
const balanceOf = (page: Page) => page.getByTestId('usdc-balance')

test('create project, fund, task, submit, approve, claim, and the auto-approve path', async ({ browser }) => {
  // ------------------------------------------------------------- creator
  const creator = await actor(browser, accounts.creator)
  await shot(creator.page, '01-home')

  await creator.page.getByRole('navigation').getByRole('link', { name: 'Creator' }).click()
  await creator.page.getByTestId('meta-input').fill('E2E project: Move code answers')
  await creator.page.getByTestId('create-project').click()
  const vaultText = creator.page.getByTestId('vault-address')
  await expect(vaultText).toBeVisible()
  const vault = (await vaultText.innerText()).trim()
  expect(vault).toMatch(/^0x[0-9a-fA-F]{40}$/)

  // fund: approve + deposit
  await creator.page.getByTestId('deposit-input').fill('1000')
  await creator.page.getByTestId('deposit').click()
  await expect(creator.page.getByTestId('unreserved')).toHaveText('1,000 USDC')

  // reviewer
  await creator.page.getByTestId('reviewer-input').fill(accounts.reviewer)
  await creator.page.getByTestId('add-reviewer').click()
  await expect(creator.page.getByTestId('reviewer-list')).toContainText(accounts.reviewer)

  // task: reward and fee on top are shown separately; invite-only is the default
  await expect(creator.page.getByTestId('allowlist-checkbox')).toBeChecked()
  await creator.page.getByTestId('spec-input').fill('Rank the two Move answers and explain the safer one.')
  await creator.page.getByTestId('reward-input').fill('100')
  await creator.page.getByTestId('max-input').fill('3')
  await expect(creator.page.getByTestId('cost-reward')).toHaveText('100 USDC')
  await expect(creator.page.getByTestId('cost-fee')).toHaveText('10 USDC')
  await expect(creator.page.getByTestId('cost-total')).toHaveText('330 USDC')
  await creator.page.getByTestId('create-task').click()
  await expect(creator.page.getByTestId('task-row-1')).toContainText('Invite only')
  await expect(creator.page.getByTestId('unreserved')).toHaveText('670 USDC')
  await expect(creator.page.getByTestId('reserved')).toHaveText('330 USDC')

  // allowlist both contributors
  await creator.page.getByTestId('allow-task').selectOption('1')
  await creator.page.getByTestId('allow-input').fill(`${accounts.contributorA}\n${accounts.contributorB}`)
  await creator.page.getByTestId('allow-add').click()
  await expect(tx(creator.page).first()).toBeVisible()
  await shot(creator.page, '02-creator-dashboard')

  // ------------------------------------------------ contributor A submits
  const a = await actor(browser, accounts.contributorA, `/p/${vault}/task/1`)
  await expect(a.page.getByTestId('task-reward')).toHaveText('100 USDC')
  await expect(a.page.getByTestId('slots-left')).toHaveText('3 / 3')
  await a.page.getByTestId('content-input').fill('Answer A: the second implementation avoids the dangling reference.')
  await a.page.getByRole('button', { name: 'Hash this content' }).click()
  await expect(a.page.getByTestId('hash-input')).toHaveValue(/^0x[0-9a-f]{64}$/)
  await a.page.getByTestId('uri-input').fill('ipfs://answer-a')
  await shot(a.page, '03-task-page')
  await a.page.getByTestId('submit-work').click()
  await expect(a.page.getByTestId('slots-left')).toHaveText('2 / 3')

  // ------------------------------------------------------------ reviewer
  const r = await actor(browser, accounts.reviewer, `/p/${vault}/review`)
  await expect(r.page.getByTestId('queue-row-1')).toBeVisible()
  await expect(r.page.getByTestId('time-left')).toContainText('d') // about 7 days left
  await shot(r.page, '04-reviewer-queue')
  await r.page.getByTestId('approve-1').click()
  await expect(r.page.getByTestId('decided-1')).toContainText('Approved')

  // --------------------------------------------- contributor A claims
  await a.page.getByRole('navigation').getByRole('link', { name: 'My submissions' }).click()
  await expect(a.page.getByTestId('status-1')).toContainText('Approved')
  await expect(balanceOf(a.page)).toHaveText('100,000 USDC')
  await a.page.getByTestId('claim-1').click()
  await expect(a.page.getByTestId('status-1')).toContainText('Claimed')
  await expect(balanceOf(a.page)).toHaveText('100,100 USDC')
  await shot(a.page, '05-my-submissions')

  // ------------------------------------- auto-approve path (time travel)
  const b = await actor(browser, accounts.contributorB, `/p/${vault}/task/1`)
  await b.page.getByTestId('hash-input').fill('0x' + 'cd'.repeat(32))
  await b.page.getByTestId('uri-input').fill('ipfs://answer-b')
  await b.page.getByTestId('submit-work').click()
  await expect(b.page.getByTestId('slots-left')).toHaveText('1 / 3')
  await b.page.getByRole('navigation').getByRole('link', { name: 'My submissions' }).click()
  await expect(b.page.getByTestId('status-2')).toContainText('Pending review')
  await expect(b.page.getByTestId('claim-2')).toHaveCount(0)

  // nobody reviews; jump past the 7-day review period on Anvil
  await anvil(rpcUrl, 'evm_increaseTime', [7 * 86400 + 60])
  await anvil(rpcUrl, 'evm_mine')
  await expect(b.page.getByTestId('status-2')).toContainText('Auto-approved')
  await expect(balanceOf(b.page)).toHaveText('100,000 USDC')
  await b.page.getByTestId('claim-2').click()
  await expect(b.page.getByTestId('status-2')).toContainText('Claimed')
  await expect(balanceOf(b.page)).toHaveText('100,100 USDC')

  // the reviewer can no longer decide it, it shows as past the window
  await r.page.reload()
  await expect(r.page.getByTestId('account')).toBeVisible() // wagmi reconnects the wallet on reload
  await expect(r.page.getByTestId('decided-2')).toContainText('Claimed')

  // ----------------------------------------- creator closes and withdraws
  await creator.page.getByTestId('close-task-1').click()
  await expect(creator.page.getByTestId('task-row-1')).toContainText('Closed')
  // 3 slots: 2 claimed (220 paid incl. fee), 1 unused unit released: 670 + 110
  await expect(creator.page.getByTestId('unreserved')).toHaveText('780 USDC')
  await expect(creator.page.getByTestId('reserved')).toHaveText('0 USDC')
  await creator.page.getByRole('button', { name: 'Max' }).click()
  await creator.page.getByTestId('withdraw').click()
  await expect(creator.page.getByTestId('unreserved')).toHaveText('0 USDC')
  await shot(creator.page, '06-creator-after-close')

  // public project page
  await creator.page.goto(`/p/${vault}`)
  await expect(creator.page.getByTestId('account')).toBeVisible()
  await expect(creator.page.getByTestId('task-table')).toBeVisible()
  await shot(creator.page, '07-project-page')
})
