import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category, WorkSession } from '../types'
import SessionEditor from './SessionEditor'
import TagInput from './TagInput'

const cats = [
  { id: 1, name: 'SDE Project', archived: false },
  { id: 2, name: 'AI Automation', archived: false },
] as Category[]

const timed: WorkSession = {
  id: 7,
  category_id: 1,
  log_date: '2026-10-08',
  started_at: '2026-10-08T09:00:00',
  ended_at: '2026-10-08T10:35:00',
  minutes: 95,
  note: 'auth',
  source: 'timer',
  tags: ['auth'],
  is_running: false,
  elapsed_minutes: 95,
  planned_end: null,
  deadline_id: null,
  measured_minutes: null,
  git_ref: null,
}

function renderEditor(session: WorkSession = timed, onSaved = vi.fn()) {
  render(
    <SessionEditor
      session={session}
      categories={cats}
      exams={[]}
      tagSuggestions={[]}
      onSaved={onSaved}
      onCancel={() => undefined}
      onSessionExpired={() => undefined}
    />,
  )
  return onSaved
}

afterEach(() => vi.restoreAllMocks())

describe('SessionEditor', () => {
  it('sends only what changed', async () => {
    const update = vi.spyOn(api, 'updateSession').mockResolvedValue(timed)
    const onSaved = renderEditor()
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'auth refactor' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(update).toHaveBeenCalledWith(7, { note: 'auth refactor' })
  })

  it('warns before changing a timer session’s minutes', () => {
    renderEditor()
    expect(screen.queryByText(/mark the session as edited/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '60' } })
    expect(screen.getByText(/mark the session as edited/)).toBeTruthy()
    expect(screen.getByText(/95 min stays on record/)).toBeTruthy()
  })

  it('does not warn for a hand-added session', () => {
    renderEditor({ ...timed, source: 'manual' })
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '60' } })
    expect(screen.queryByText(/mark the session as edited/)).toBeNull()
  })

  it('sends a changed branch, and an emptied one as a clear', async () => {
    const update = vi.spyOn(api, 'updateSession').mockResolvedValue(timed)
    const onSaved = renderEditor({ ...timed, git_ref: 'feature/auth' })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(update).toHaveBeenCalledWith(7, { git_ref: '' })
  })

  it('saving with no changes calls nothing', () => {
    const update = vi.spyOn(api, 'updateSession').mockResolvedValue(timed)
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).not.toHaveBeenCalled()
  })

  it('splits at the chosen minute', async () => {
    const split = vi.spyOn(api, 'splitSession').mockResolvedValue([])
    const onSaved = renderEditor()
    const button = screen.getByRole('button', { name: 'Split' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Split after'), { target: { value: '40' } })
    fireEvent.click(button)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(split).toHaveBeenCalledWith(7, 40)
  })

  it('keeps minutes locked while the timer runs', () => {
    renderEditor({ ...timed, is_running: true, ended_at: null })
    expect((screen.getByLabelText('Minutes') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull()
  })
})

describe('TagInput', () => {
  it('adds lowercased, trimmed, de-duplicated tags on Enter and comma', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['dp']} onChange={onChange} />)
    const input = screen.getByLabelText('Tags')
    fireEvent.change(input, { target: { value: '  Graphs ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['dp', 'graphs'])
    fireEvent.change(input, { target: { value: 'DP, trees,' } })
    expect(onChange).toHaveBeenLastCalledWith(['dp', 'trees'])
  })

  it('removes the last tag on Backspace in an empty field', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['dp', 'graphs']} onChange={onChange} />)
    fireEvent.keyDown(screen.getByLabelText('Tags'), { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith(['dp'])
  })
})
