import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import TabBlock from './TabBlock'

const tabs = [
  { id: 'a', label: 'Alpha', hotkey: 'x', content: <p>alpha body</p> },
  { id: 'b', label: 'Beta', hotkey: 'y', content: <p>beta body</p> },
]

describe('TabBlock', () => {
  it('shows one tab and switches on click', () => {
    render(<TabBlock tabs={tabs} storageKey="t1" />)
    expect(screen.getByText('alpha body')).toBeInTheDocument()
    expect(screen.queryByText('beta body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }))
    expect(screen.getByText('beta body')).toBeInTheDocument()
  })

  it('switches on its hotkey, but not while typing', () => {
    render(
      <>
        <input aria-label="field" />
        <TabBlock tabs={tabs} storageKey="t2" />
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'y' })
    expect(screen.queryByText('beta body')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'y' })
    expect(screen.getByText('beta body')).toBeInTheDocument()
  })

  it('remembers the chosen tab', () => {
    const { unmount } = render(<TabBlock tabs={tabs} storageKey="t3" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }))
    unmount()
    render(<TabBlock tabs={tabs} storageKey="t3" />)
    expect(screen.getByText('beta body')).toBeInTheDocument()
  })
})
