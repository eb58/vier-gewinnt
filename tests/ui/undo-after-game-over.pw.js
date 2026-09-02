import { expect, test } from '@playwright/test'

const installDeterministicWorker = () => {
  window.Worker = class {
    constructor() {
      this.listeners = { message: [], error: [] }
      this.stopped = false
    }

    addEventListener(type, listener) {
      this.listeners[type].push(listener)
    }

    postMessage({ id }) {
      setTimeout(() => {
        if (this.stopped) return
        const result = { bestMove: 6, score: 0, depth: 1, nodes: 1, elapsedTime: '0.001', timedOut: false }
        this.listeners.message.forEach((listener) => listener({ data: { id, ok: true, result } }))
      }, 10)
    }

    terminate() {
      this.stopped = true
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installDeterministicWorker)
  await page.goto('/')
  await expect(page.locator('.cell')).toHaveCount(42)
})

test('letzter Gewinnzug lässt sich nach Spielende zurücknehmen', async ({ page }) => {
  const columnOne = page.getByRole('button', { name: 'In Spalte 1 werfen' })
  const undo = page.getByRole('button', { name: 'Zurück' })
  const result = page.locator('#result')

  await expect(undo).toBeDisabled()
  await expect(result).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const moveCount of ['2', '4', '6']) {
    await columnOne.click()
    await expect(page.locator('#moveCount')).toHaveText(moveCount)
    await expect(columnOne).toBeEnabled()
  }

  await columnOne.click()
  await expect(result).toBeVisible()
  await expect(page.locator('#resultTitle')).toHaveText('Du gewinnst.')
  await expect(page.locator('#turnPill')).toHaveText('Runde beendet')
  await expect(page.locator('#moveCount')).toHaveText('7')
  await expect(page.locator('#humanScore')).toHaveText('1')
  await expect(page.locator('.cell.human')).toHaveCount(4)
  await expect(page.locator('.cell.ai')).toHaveCount(3)
  await expect(page.locator('.cell.win-cell')).toHaveCount(4)
  await expect(undo).toBeEnabled()
  await expect(page.locator('.drop-button:enabled')).toHaveCount(0)

  await undo.click()
  await expect(result).toBeHidden()
  await expect(page.locator('#statusTitle')).toHaveText('Zug zurückgenommen.')
  await expect(page.locator('#turnPill')).toHaveText('Du bist dran')
  await expect(page.locator('#moveCount')).toHaveText('6')
  await expect(page.locator('#humanScore')).toHaveText('0')
  await expect(page.locator('.cell.human')).toHaveCount(3)
  await expect(page.locator('.cell.ai')).toHaveCount(3)
  await expect(page.locator('.cell.win-cell')).toHaveCount(0)
  await expect(page.locator('#board')).toHaveClass(/\bplayable\b/)
  await expect(columnOne).toBeEnabled()
  await expect(undo).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const boardWidth = document.querySelector('#board').getBoundingClientRect().width
    return boardWidth <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth
  })).toBe(true)
})
