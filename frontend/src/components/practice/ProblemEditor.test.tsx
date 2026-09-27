import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '../../api/client'
import type { Problem } from '../../types'
import ProblemEditor from './ProblemEditor'

const problem: Problem = {
  id: 5,
  category_id: 4,
  title: 'Two Sum',
  url: null,
  topic: 'arrays',
  difficulty: 'easy',
  needed_hint: false,
  solved_on: '2026-09-20',
  notes: null,
  reviews: [{ id: 11, reviewed_on: '2026-09-23', outcome: 'solid' }],
  stage: 1,
  due_on: '2026-10-03',
  mastered: false,
  overdue_days: 0,
}

function renderEditor(onChanged = vi.fn(), onClose = vi.fn()) {
  render(
    <ProblemEditor
      problem={problem}
      topics={['arrays', 'dp']}
      onChanged={onChanged}
      onClose={onClose}
      onSessionExpired={() => undefined}
    />,
  )
  return { onChanged, onClose }
}

afterEach(() => vi.restoreAllMocks())

describe('ProblemEditor', () => {
  it('sends only what changed, then closes', async () => {
    const update = vi.spyOn(api, 'updateProblem').mockResolvedValue(problem)
    const { onChanged, onClose } = renderEditor()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: ' Two Sum II ' },
    })
    fireEvent.click(screen.getByLabelText('needed a hint'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(update).toHaveBeenCalledWith(5, { title: 'Two Sum II', needed_hint: true })
    expect(onChanged).toHaveBeenCalled()
  })

  it('says the question moves with the date', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Solved on'), {
      target: { value: '2026-09-19' },
    })
    expect(screen.getByText(/moves from 2026-09-20 to 2026-09-19/)).toBeTruthy()
  })

  it('shows the server’s refusal and stays open', async () => {
    vi.spyOn(api, 'updateProblem').mockRejectedValue(
      new ApiError(
        422,
        "It was revised on 2026-09-23, so it can't have been solved after that.",
      ),
    )
    const { onClose } = renderEditor()
    fireEvent.change(screen.getByLabelText('Solved on'), {
      target: { value: '2026-09-25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /revised on 2026-09-23/,
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes a revision only after a second click', async () => {
    const remove = vi.spyOn(api, 'deleteReview').mockResolvedValue(problem)
    const { onChanged } = renderEditor()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove the 2026-09-23 revision' }),
    )
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(5, 11))
    expect(onChanged).toHaveBeenCalled()
  })
})
