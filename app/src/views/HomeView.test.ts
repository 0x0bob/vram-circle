import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

const findProjects = vi.fn()
vi.mock('../services/chain', () => ({ findProjects: (...a: unknown[]) => findProjects(...a) }))
vi.mock('@wagmi/vue', () => ({
  useConnection: () => ({ address: ref('0x1fA4CA45eB0E49B6cf7F2C071980757521692984'), isConnected: ref(true) }),
}))

const mountHome = async () => {
  const { default: HomeView } = await import('./HomeView.vue')
  const w = mount(HomeView, { global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } } })
  await flushPromises()
  return w
}

beforeEach(() => {
  findProjects.mockReset()
})

// Regression (step 3c, 2026-11-13): a rate-limited scan was swallowed and the page said "None yet" right after the
// user created a project, so they believed the project was lost.
describe('HomeView: projects I created', () => {
  it('says None yet only when the chain was read and there really are none', async () => {
    findProjects.mockResolvedValue([])
    const w = await mountHome()
    expect(w.text()).toContain('None yet')
    expect(w.find('[data-testid=projects-error]').exists()).toBe(false)
  })

  it('test_regression_loadFailureIsNotShownAsNoProjects', async () => {
    findProjects.mockRejectedValue(new Error('rate limit exceeded'))
    const w = await mountHome()
    expect(w.text()).not.toContain('None yet')
    expect(w.get('[data-testid=projects-error]').text()).toMatch(/could not load/i)
  })

  it('retries from the error and then lists the projects', async () => {
    const vault = '0x0dE411c783f4Ea4A6FD35d82A263d7FB888EABEF'
    findProjects.mockRejectedValueOnce(new Error('rate limit exceeded')).mockResolvedValue([vault])
    const w = await mountHome()
    await w.get('[data-testid=projects-retry]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid=projects-error]').exists()).toBe(false)
    expect(w.text()).toContain('0x0dE4')
  })
})
