import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '../api/client'
import ExportRestore from './ExportRestore'

const summary = {
  exported_at: '2026-09-24',
  first_day: '2026-08-01',
  last_day: '2026-09-23',
  counts: [
    { label: 'sessions', count: 12 },
    { label: 'daily entries', count: 40 },
  ],
}

function pick(text: string, name = 'dayshift-export-2026-09-24.json') {
  const file = new File([text], name, { type: 'application/json' })
  fireEvent.change(screen.getByLabelText('Export file to restore from'), {
    target: { files: [file] },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('ExportRestore', () => {
  it('previews the file, then restores only after RESTORE is typed', async () => {
    const preview = vi.spyOn(api, 'previewExportRestore').mockResolvedValue(summary)
    const restore = vi.spyOn(api, 'restoreExport').mockResolvedValue(summary)
    render(<ExportRestore onSessionExpired={() => undefined} />)
    pick('{"format": 2, "tables": {}}')
    expect(await screen.findByText(/12 sessions · 40 daily entries/)).toBeTruthy()
    expect(preview).toHaveBeenCalledWith({ format: 2, tables: {} })

    const button = screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(
      screen.getByLabelText('Type RESTORE to confirm the export restore'),
      {
        target: { value: 'RESTORE' },
      },
    )
    fireEvent.click(button)
    await waitFor(() => expect(restore).toHaveBeenCalledWith({ format: 2, tables: {} }))
  })

  it('says so when the file is not JSON, without calling the server', async () => {
    const preview = vi.spyOn(api, 'previewExportRestore')
    render(<ExportRestore onSessionExpired={() => undefined} />)
    pick('not json at all')
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't JSON/)
    expect(preview).not.toHaveBeenCalled()
  })

  it('shows the server’s reason for refusing an old export', async () => {
    vi.spyOn(api, 'previewExportRestore').mockRejectedValue(
      new ApiError(422, 'This export is from an older Dayshift… Export again'),
    )
    render(<ExportRestore onSessionExpired={() => undefined} />)
    pick('{"exported_at": "2026-09-24"}')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Export again/)
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })
})
