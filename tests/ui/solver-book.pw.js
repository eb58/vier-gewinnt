import { expect, test } from '@playwright/test'

// Ohne Worker-Attrappe: hier soll gerade der echte Solver im echten Worker laufen,
// samt geladenem Eroeffnungsbuch.
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.cell')).toHaveCount(42)
})

test('KI antwortet mit dem Solver und nutzt das Eroeffnungsbuch', async ({ page }) => {
  const bookRequest = page.waitForResponse((r) => r.url().endsWith('/data/book-8.bin'))

  await page.getByRole('button', { name: 'In Spalte 4 werfen' }).click()
  await expect(page.locator('#moveCount')).toHaveText('2', { timeout: 30000 })

  // Das Buch wurde tatsaechlich geholt, nicht nur der Solver ohne Buch benutzt.
  expect((await bookRequest).ok()).toBe(true)

  // Die Bewertung ist der exakte Pons-Score. Nach 4 und der besten Antwort steht die
  // Stellung fuer den Anziehenden auf Gewinn, aus Sicht des Ziehenden also negativ.
  const score = await page.locator('#depthStat').textContent()
  expect(Number(score)).toBeLessThan(0)

  await expect(page.locator('#engineBadge')).toHaveText(/geloest/)
  await expect(page.locator('.cell.ai')).toHaveCount(1)
})
