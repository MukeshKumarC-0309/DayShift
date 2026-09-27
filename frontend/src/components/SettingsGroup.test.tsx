import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Setting } from '../types'
import SettingsGroup from './SettingsGroup'

const setting = (
  key: string,
  group: Setting['group'],
  kind: Setting['kind'],
  value: string,
) =>
  ({
    key,
    label: key,
    kind,
    value,
    default: value,
    minimum: null,
    maximum: null,
    help: '',
    group,
  }) as Setting

const all = [
  setting('par_window_days', 'scoring', 'int', '7'),
  setting('reminder_time', 'backup', 'time', '21:00'),
  setting('reminder_enabled', 'backup', 'bool', 'false'),
]

describe('SettingsGroup', () => {
  it('shows only its group and saves only what changed', async () => {
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(all)
    render(
      <SettingsGroup
        title="Backups"
        group="backup"
        description=""
        settings={all}
        onUpdated={() => undefined}
        onSessionExpired={() => undefined}
      />,
    )
    expect(screen.queryByLabelText('par_window_days')).toBeNull()
    fireEvent.change(screen.getByLabelText('reminder_time'), {
      target: { value: '22:30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ reminder_time: '22:30' }))
  })

  it('resets only its own group', async () => {
    const reset = vi.spyOn(api, 'resetSettings').mockResolvedValue(all)
    render(
      <SettingsGroup
        title="Backups"
        group="backup"
        description=""
        settings={all}
        onUpdated={() => undefined}
        onSessionExpired={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset backups' }))
    await waitFor(() => expect(reset).toHaveBeenCalledWith('backup'))
  })
})
