import { describe, expect, test } from 'vitest'
import { Board, COLS, ROWS, solve, findBestMove as solverFindBestMove, setBook, resetTranspositionTables } from '../engines/cf-solver.js'

const range = (n) => [...Array(n).keys()]
const snapshot = (board) => ({
  curLo: board.curLo, curHi: board.curHi,
  maskLo: board.maskLo, maskHi: board.maskHi,
  cntMoves: board.cntMoves,
  currentPlayer: board.currentPlayer,
  cells: range(COLS).flatMap((c) => range(ROWS).map((r) => board.ownerAt(c, r)))
})

const seeded = (value) => () => (value = (1664525 * value + 1013904223) >>> 0) / 4294967296

describe('SOLVER-BOARD', () => {
  test('stellt nach doMove/undoMove jedes Feld wieder her', () => {
    const board = new Board()
    const before = snapshot(board)
    const moves = [3, 2, 4, 1, 5, 0, 6, 3, 2, 4, 1, 5]

    moves.forEach((col) => board.doMove(col))
    moves.toReversed().forEach((col) => board.undoMove(col))

    expect(snapshot(board)).toEqual(before)
  })

  test('ordnet Steine dem richtigen Spieler zu, auch wenn Spieler 1 beginnt', () => {
    const board = new Board()
    board.init(1)
    expect(board.currentPlayer).toBe(1)
    board.doMove(3) // Spieler 1
    expect(board.currentPlayer).toBe(0)
    board.doMove(3) // Spieler 0
    expect(board.ownerAt(3, 0)).toBe(1)
    expect(board.ownerAt(3, 1)).toBe(0)
    expect(board.ownerAt(3, 2)).toBe(-1)
    expect(board.opponentPlayer()).toBe(0)
  })

  test('meldet volle und leere Spalten statt still zu verfaelschen', () => {
    const board = new Board()
    range(ROWS).forEach(() => board.doMove(0))
    expect(board.canPlay(0)).toBe(false)
    expect(board.getHeightOfCol(0)).toBe(ROWS)
    expect(() => board.doMove(0)).toThrow(/voll/)
    expect(() => board.undoMove(1)).toThrow(/leer/)
  })
})

// Voellig unabhaengige Referenz: reines Negamax ueber den ganzen Restbaum, ohne Alpha-Beta,
// ohne Transpositionstabelle, ohne Buch, ohne Drohungsregeln. Nur fuer Stellungen mit
// wenigen freien Feldern bezahlbar - genau dort aber ein scharfer Test der Score-Semantik.
const bruteForce = (board) => {
  if (board.isDraw()) return 0
  const cols = range(COLS).filter((c) => board.canPlay(c))
  if (cols.some((c) => board.isWinningMove(c))) return (COLS * ROWS + 1 - board.cntMoves) >> 1
  return cols.reduce((best, c) => {
    board.doMove(c)
    const score = -bruteForce(board)
    board.undoMove(c)
    return Math.max(best, score)
  }, -Infinity)
}

describe('SOLVER gegen Brute Force', () => {
  test('trifft den exakten Score auf zufaelligen Endspielstellungen', () => {
    setBook(null) // die Referenz kennt kein Buch
    const random = seeded(0xc0ffee)
    let geprueft = 0

    range(25).forEach(() => {
      // 36 Steine lassen sechs freie Felder - fuer die Referenz gerade noch bezahlbar.
      // Sofort gewinnende Zuege werden beim Aufbau gemieden, sonst waere die Stellung
      // schon entschieden und der Vergleich trivial.
      const moves = []
      const board = new Board()
      while (board.cntMoves < 36) {
        const cols = range(COLS).filter((c) => board.canPlay(c) && !board.isWinningMove(c))
        if (!cols.length) return
        const col = cols[Math.floor(random() * cols.length)]
        board.doMove(col)
        moves.push(col)
      }

      const erwartet = bruteForce(board)
      const kopie = new Board()
      moves.forEach((col) => kopie.doMove(col))
      resetTranspositionTables()

      expect(solve(kopie, { maxThinkingTime: 20000 }).score).toBe(erwartet)
      geprueft++
    })

    expect(geprueft).toBeGreaterThan(15)
  }, 120000)
})

// Portiert aus cf-engine-1.test.js, weil es diese Faelle sonst nirgends mehr gaebe.
describe('SOLVER: Abbruch und Tabelle', () => {
  test('bricht bei abgelaufener Zeit ab, ohne das Brett zu veraendern', () => {
    setBook(null)
    resetTranspositionTables()
    const board = new Board('4444') // ohne Buch nicht in Millisekunden loesbar
    const before = snapshot(board)
    const r = solve(board, { maxThinkingTime: 5 })

    expect(r.solved).toBe(false)
    expect(r.score).toBeUndefined()
    expect(r.min).toBeLessThanOrEqual(r.max)
    expect(snapshot(board)).toEqual(before)
  })

  test('liefert mit warmer Tabelle dasselbe Ergebnis, aber billiger', () => {
    setBook(null)
    resetTranspositionTables()
    const opts = { maxThinkingTime: 30000 }
    const kalt = solve(new Board('444444'), opts)
    const warm = solve(new Board('444444'), opts)

    expect(warm.score).toBe(kalt.score)
    expect(warm.nodes).toBeLessThan(kalt.nodes)
  }, 60000)

  test('erzwingt den Block gegen eine einzelne Drohung', () => {
    setBook(null)
    resetTranspositionTables()
    // Spieler 1 droht mit Spalte 3; jeder andere Zug verliert sofort.
    const board = new Board('3731713')
    expect(board.isWinningMove(2)).toBe(false) // nicht der eigene Gewinn
    const opts = { maxThinkingTime: 10000 }
    expect(solverFindBestMove(board, opts).bestMove).toBe(2)
  })
})
