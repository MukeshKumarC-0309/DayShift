import { expect, test } from '@playwright/test'

/**
 * The path that matters most, end to end, on a fresh install:
 * first-run setup → dashboard → log minutes → quick add + undo → command
 * palette → practice → habits. Runs against a throwaway backend (see config).
 */

test('first run to a logged day', async ({ page }) => {
  // --- First run: no credentials yet, so the app asks for them.
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await page.locator('#setup-username').fill('e2e')
  await page.locator('#setup-passcode').fill('e2e-passcode')
  await page.locator('#setup-confirm').fill('e2e-passcode')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('link', { name: 'Practice' })).toBeVisible()

  // --- Log 45 minutes of SDE Project through the Log tab.
  await page.getByRole('tab', { name: 'Log' }).click()
  await page.getByLabel('SDE Project minutes').fill('45')
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('img', { name: /^SDE Project: 45 of/ })).toBeVisible()

  // --- Quick add from the dial, then undo it.
  await page.getByLabel('Add 15 minutes to SDE Project today').click()
  await expect(page.getByRole('img', { name: /^SDE Project: 60 of/ })).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect(page.getByRole('img', { name: /^SDE Project: 45 of/ })).toBeVisible()

  // --- Command palette quick entry.
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Command' }).fill('+25 ai')
  await expect(
    page.getByRole('option', { name: /Add 25 min to AI Automation/ }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('img', { name: /^AI Automation: 25 of/ })).toBeVisible()

  // --- Keyboard shortcuts: the ? key, and the ⋯ menu item for the same panel.
  await page.locator('main').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+Slash')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click()
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')

  // --- Log a DSA problem; it counts as a question.
  await page.goto('/practice')
  await page.getByLabel('Problem title').fill('Two Sum')
  await page.getByLabel('Topic', { exact: true }).fill('Arrays')
  await page.getByRole('button', { name: 'Log problem' }).click()
  await expect(page.getByText(/Logged — counted as a DSA question/)).toBeVisible()

  // --- A habit, ticked today.
  await page.goto('/goals')
  await page.getByLabel('Habit name').fill('No phone first hour')
  await page.getByRole('button', { name: 'Add habit' }).click()
  await page.getByRole('button', { name: 'Tick today' }).click()
  await expect(page.getByRole('button', { name: '✓ Done today' })).toBeVisible()
})
