import { Board, COLS, ROWS } from './cf-engine.js'

export { Board }

const AREA = COLS * ROWS
const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6]
const SEARCH_ABORTED = Symbol('solver-aborted')
const TIME_CHECK_MASK = 1023
const LOST = -1 // Rueckgabe von nonLosingMoves, wenn jeder Zug verliert

// Score nach Pons: ein Sieg mit dem naechsten Stein bei `stones` Steinen auf dem Brett ist
// (43 - stones) / 2 wert. Frueher Sieg = hoeher, Remis = 0, Niederlage spiegelbildlich.
// Der Wertebereich ist damit nur [-18, 18] - klein genug, um ihn binaer einzugrenzen.
const winScore = (stones) => (AREA + 1 - stones) >> 1
const lossScore = (stones) => -((AREA - stones) >> 1)

const TT_FLAGS = { exact: 1, lower_bound: 2, upper_bound: 3 }

class TranspositionTable {
  constructor(bits) {
    this.mask = (1 << bits) - 1
    this.keys = new Uint32Array(this.mask + 1)
    this.scores = new Int8Array(this.mask + 1)
    this.flags = new Int8Array(this.mask + 1)
    this.bestMoves = new Uint8Array(this.mask + 1)
  }

  // Keine Tiefe mehr: der Solver sucht immer bis zum Terminal, ein Eintrag gilt damit
  // absolut fuer die Stellung und nicht nur bis zu einer Resttiefe.
  store(hash, lock, score, flag, bestMove = -1) {
    const idx = hash & this.mask
    this.keys[idx] = lock
    this.scores[idx] = score
    this.flags[idx] = flag
    this.bestMoves[idx] = bestMove >= 0 ? bestMove + 1 : 0
    return score
  }

  probe(hash, lock, alpha, beta) {
    const idx = hash & this.mask
    if (this.keys[idx] !== lock || this.flags[idx] === 0) return null
    const score = this.scores[idx]
    const flag = this.flags[idx]
    if (flag === TT_FLAGS.exact) return score
    if (flag === TT_FLAGS.lower_bound && score >= beta) return score
    if (flag === TT_FLAGS.upper_bound && score <= alpha) return score
    return null
  }

  getBestMove(hash, lock) {
    const idx = hash & this.mask
    return this.keys[idx] === lock && this.bestMoves[idx] > 0 ? this.bestMoves[idx] - 1 : -1
  }
}

const ttPool = new Map()
const getTranspositionTable = (bits = 23) => ttPool.get(bits) ?? ttPool.set(bits, new TranspositionTable(bits)).get(bits)
export const resetTranspositionTables = () => ttPool.clear()

// Fuellt `out` mit den Zuegen, die nicht sofort verlieren, und liefert deren Anzahl.
// LOST bedeutet: jeder Zug verliert, die Stellung ist bei perfektem Gegenspiel verloren.
const nonLosingMoves = (board, out) => {
  const opponent = 1 - board.currentPlayer
  let forced = -1
  let forcedCount = 0
  for (const c of CENTER_ORDER) {
    if (board.heightCols[c] >= ROWS || !board.checkWinning(c, opponent)) continue
    if (++forcedCount > 1) return LOST // zwei Drohungen, nur eine blockbar
    forced = c
  }

  let n = 0
  for (const c of CENTER_ORDER) {
    const row = board.heightCols[c]
    if (row >= ROWS) continue
    if (forcedCount === 1 && c !== forced) continue
    // Ein Zug, der dem Gegner direkt darueber den Sieg schenkt, verliert ebenfalls.
    if (board.checkWinning(c, opponent, row + 1)) continue
    out[n++] = c
  }
  return n === 0 ? LOST : n
}

class Solver {
  constructor(board, info, tt, timeOut) {
    this.board = board
    this.info = info
    this.tt = tt
    this.timeOut = timeOut
    this.moveLists = Array.from({ length: AREA + 1 }, () => new Uint8Array(COLS))
  }

  negamax = (alpha, beta, ply = 0) => {
    if ((this.info.nodes & TIME_CHECK_MASK) === 0 && this.timeOut()) return SEARCH_ABORTED
    ++this.info.nodes

    const board = this.board
    const stones = board.cntMoves
    if (stones === AREA) return 0

    const moves = this.moveLists[ply]
    const n = nonLosingMoves(board, moves)
    if (n === LOST) return lossScore(stones)

    // Zwei Steine vor Schluss kann niemand mehr gewinnen, ohne dass es oben aufgefallen waere.
    if (stones >= AREA - 2) return 0

    // Fenster an der Restzugzahl verengen: frueher als in (AREA-1-stones)/2 Zuegen kann
    // niemand mehr gewinnen. Das schneidet ganze Teilbaeume, bevor sie betreten werden.
    const max = (AREA - 1 - stones) >> 1
    if (beta > max) {
      beta = max
      if (alpha >= beta) return beta
    }
    const min = -((AREA - 2 - stones) >> 1)
    if (alpha < min) {
      alpha = min
      if (alpha >= beta) return alpha
    }

    const hash = board.hash
    const lock = board.lock
    const cached = this.tt.probe(hash, lock, alpha, beta)
    if (cached !== null) return cached

    const originalAlpha = alpha
    const ttMove = this.tt.getBestMove(hash, lock)
    let bestMove = moves[0]

    for (let i = -1; i < n; i++) {
      // Der TT-Zug zuerst, danach die uebrigen in Mittenreihenfolge.
      const c = i < 0 ? ttMove : moves[i]
      if (i < 0 ? c < 0 : c === ttMove) continue
      if (i < 0 && !this.isPlayable(c, moves, n)) continue

      board.doMove(c)
      const childScore = this.negamax(-beta, -alpha, ply + 1)
      board.undoMove(c)
      if (childScore === SEARCH_ABORTED) return SEARCH_ABORTED

      const score = -childScore
      if (score >= beta) return this.tt.store(hash, lock, score, TT_FLAGS.lower_bound, c)
      if (score > alpha) {
        alpha = score
        bestMove = c
      }
    }

    const flag = alpha > originalAlpha ? TT_FLAGS.exact : TT_FLAGS.upper_bound
    return this.tt.store(hash, lock, alpha, flag, bestMove)
  }

  isPlayable = (c, moves, n) => {
    for (let i = 0; i < n; i++) if (moves[i] === c) return true
    return false
  }
}

// Binaere Suche ueber den Score: jeder Schritt ist eine Suche mit leerem Fenster, die nur
// "groesser oder kleiner als med" beantwortet. Das ist der Grund, warum ein Solver schnell
// ist - ein volles Fenster wuerde nie so scharf schneiden.
export const solve = (board, opts = {}) => {
  const settings = { maxThinkingTime: 60000, ttBits: 23, ...opts }
  const start = performance.now()
  const info = { nodes: 0, stopAt: Date.now() + settings.maxThinkingTime }
  const timeOut = () => Date.now() >= info.stopAt
  const solver = new Solver(board, info, getTranspositionTable(settings.ttBits), timeOut)

  let min = -((AREA - board.cntMoves) >> 1)
  let max = (AREA + 1 - board.cntMoves) >> 1
  let aborted = false

  while (min < max) {
    let med = min + ((max - min) >> 1)
    if (med <= 0 && (min >> 1) < med) med = min >> 1
    else if (med >= 0 && (max >> 1) > med) med = max >> 1

    const r = solver.negamax(med, med + 1)
    if (r === SEARCH_ABORTED) {
      aborted = true
      break
    }
    if (r <= med) max = r
    else min = r
    settings.onBound?.({ min, max, nodes: info.nodes, elapsedTime: (performance.now() - start) / 1000 })
  }

  return {
    score: aborted ? undefined : min,
    min,
    max,
    solved: !aborted,
    nodes: info.nodes,
    elapsedTime: ((performance.now() - start) / 1000).toFixed(3)
  }
}

// Bester Zug: die Wurzelzuege einzeln aufloesen. Verlierende Zuege sind vorher schon raus.
export const findBestMove = (board, opts = {}) => {
  const start = performance.now()
  const moves = new Uint8Array(COLS)
  const n = nonLosingMoves(board, moves)
  const playable = CENTER_ORDER.filter((c) => board.heightCols[c] < ROWS)
  if (n === LOST) return { bestMove: playable[0], score: lossScore(board.cntMoves), solved: true, nodes: 0, elapsedTime: '0.000' }

  let best = moves[0]
  let bestScore = -Infinity
  let nodes = 0
  let solved = true

  for (let i = 0; i < n; i++) {
    const c = moves[i]
    board.doMove(c)
    const r = solve(board, opts)
    board.undoMove(c)
    nodes += r.nodes
    if (!r.solved) { solved = false; continue }
    if (-r.score > bestScore) {
      bestScore = -r.score
      best = c
    }
  }

  return { bestMove: best, score: solved ? bestScore : undefined, solved, nodes, elapsedTime: ((performance.now() - start) / 1000).toFixed(3) }
}
