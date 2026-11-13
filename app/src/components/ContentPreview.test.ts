import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContentPreview from './ContentPreview.vue'

const mountIt = (status: string, text: string | null = null) =>
  mount(ContentPreview, { props: { submissionId: 4, content: { status, text } as never } })

describe('ContentPreview', () => {
  it('shows verified content with a note that it matches the on-chain hash', () => {
    const w = mountIt('match', 'the contributor answer')
    expect(w.get('[data-testid=content-4]').text()).toBe('the contributor answer')
    expect(w.text()).toMatch(/matches the hash/i)
    expect(w.find('[data-testid=warn-content-hash-4]').exists()).toBe(false)
  })

  it('on a hash mismatch shows a clear warning and hides the text until the reviewer asks for it', async () => {
    const w = mountIt('mismatch', 'altered text')
    expect(w.get('[data-testid=warn-content-hash-4]').text()).toMatch(/does not match/i)
    expect(w.find('[data-testid=content-4]').exists()).toBe(false)
    await w.get('[data-testid=show-anyway-4]').trigger('click')
    expect(w.get('[data-testid=content-4]').text()).toBe('altered text')
    expect(w.find('[data-testid=warn-content-hash-4]').exists()).toBe(true) // the warning stays
  })

  it('explains the access states', () => {
    expect(mountIt('unauthorized').text()).toMatch(/sign/i)
    expect(mountIt('forbidden').text()).toMatch(/creator|reviewer|contributor/i)
    expect(mountIt('unavailable').text()).toMatch(/not found|unavailable/i)
    expect(mountIt('loading').text()).toMatch(/loading/i)
  })

  it('renders content as text, never as HTML', () => {
    const w = mountIt('match', '<img src=x onerror=alert(1)> <b>bold</b>')
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('b').exists()).toBe(false)
    expect(w.get('[data-testid=content-4]').text()).toContain('<img src=x')
  })
})
