import { lookupBook } from './cf-book.js'

export const COLS = 7
export const ROWS = 6

// 49-Bit-Layout nach Pons: Bit (col * 7 + row), Zeile 6 jeder Spalte ist ein Waechterbit
// und bleibt leer. Dadurch ist jede Gewinnrichtung ein konstanter Bitabstand - vertikal 1,
// horizontal 7, Diagonalen 6 und 8 - ohne dass ein Shift in die Nachbarspalte laeuft.
// JS kann nur 32 Bit bitweise, also fuehren wir jeden Wert als Paar (lo, hi): lo sind die
// Bits 0..31, hi die Bits 32..48.
const H1 = ROWS + 1
const HI_MASK = 0x1ffff // 17 Bit
const AREA = COLS * ROWS

const shlLo = (lo, k) => lo << k
const shlHi = (lo, hi, k) => ((hi << k) | (lo >>> (32 - k))) & HI_MASK
const shrLo = (lo, hi, k) => (lo >>> k) | (hi << (32 - k))
const shrHi = (hi, k) => hi >>> k

const popcount = (x) => {
  x -= (x >> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
  x = (x + (x >> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >> 24
}

const bitLo = (col, row) => { const b = col * H1 + row; return b < 32 ? 1 << b : 0 }
const bitHi = (col, row) => { const b = col * H1 + row; return b < 32 ? 0 : 1 << (b - 32) }
const range = (n) => [...Array(n).keys()]

const BOTTOM_LO = range(COLS).reduce((m, c) => m | bitLo(c, 0), 0)
const BOTTOM_HI = range(COLS).reduce((m, c) => m | bitHi(c, 0), 0)
const BOARD_LO = range(COLS).reduce((m, c) => range(ROWS).reduce((n, r) => n | bitLo(c, r), m), 0)
const BOARD_HI = range(COLS).reduce((m, c) => range(ROWS).reduce((n, r) => n | bitHi(c, r), m), 0)
const COLUMN_LO = Int32Array.from(range(COLS), (c) => range(ROWS).reduce((m, r) => m | bitLo(c, r), 0))
const COLUMN_HI = Int32Array.from(range(COLS), (c) => range(ROWS).reduce((m, r) => m | bitHi(c, r), 0))
const TOP_LO = Int32Array.from(range(COLS), (c) => bitLo(c, ROWS - 1))
const TOP_HI = Int32Array.from(range(COLS), (c) => bitHi(c, ROWS - 1))

// Ergebnis der 49-Bit-Rechenschritte. Modulweite Ausgabe statt Rueckgabeobjekt, damit im
// Suchkern nichts alloziert wird - der Wert wird immer sofort ausgelesen.
let outLo = 0
let outHi = 0

// 49-Bit-Addition mit Uebertrag. mask + bottom laesst in jeder Spalte einen Uebertrag bis
// zur ersten freien Zelle laufen und liefert so alle spielbaren Felder auf einmal.
const add49 = (aLo, aHi, bLo, bHi) => {
  const sum = (aLo >>> 0) + (bLo >>> 0)
  outLo = sum | 0
  outHi = (aHi + bHi + (sum > 0xffffffff ? 1 : 0)) & HI_MASK
}

// Spiegelt das Brett links-rechts: Spalte c wandert nach COLS-1-c, die Zeile bleibt.
// Im 49-Bit-Layout ist das ein Vertauschen ganzer 7-Bit-Bloecke.
const mirror49 = (lo, hi) => {
  let rLo = 0
  let rHi = 0
  for (let c = 0; c < COLS; c++) {
    const b = c * H1
    // shrLo taugt nur fuer Weiten unter 32 - JS rechnet Schiebeweiten modulo 32.
    const v = (b === 0 ? lo : b < 32 ? shrLo(lo, hi, b) : hi >>> (b - 32)) & 0x7f
    if (v === 0) continue
    const t = (COLS - 1 - c) * H1
    if (t >= 32) rHi |= v << (t - 32)
    else {
      rLo |= v << t
      if (t > 25) rHi |= v >>> (32 - t) // Block laeuft ueber die Wortgrenze
    }
  }
  outLo = rLo
  outHi = rHi
}

// Alle Felder, auf denen `p` mit einem weiteren Stein vier in einer Reihe haette - auch
// solche, die noch nicht spielbar sind. Das ist der Kern: eine Berechnung statt sieben
// Spaltenpruefungen, und sie liefert die ganze Drohungsmenge statt nur der ersten.
const computeWinning = (pLo, pHi, mLo, mHi) => {
  let rLo = shlLo(pLo, 1) & shlLo(pLo, 2) & shlLo(pLo, 3)
  let rHi = shlHi(pLo, pHi, 1) & shlHi(pLo, pHi, 2) & shlHi(pLo, pHi, 3)

  for (const k of [H1, ROWS, ROWS + 2]) { // horizontal, Diagonale \, Diagonale /
    const k2 = k * 2
    const k3 = k * 3
    const upLo = shlLo(pLo, k)
    const upHi = shlHi(pLo, pHi, k)
    const up2Lo = shlLo(pLo, k2)
    const up2Hi = shlHi(pLo, pHi, k2)
    const up3Lo = shlLo(pLo, k3)
    const up3Hi = shlHi(pLo, pHi, k3)
    const dnLo = shrLo(pLo, pHi, k)
    const dnHi = shrHi(pHi, k)
    const dn2Lo = shrLo(pLo, pHi, k2)
    const dn2Hi = shrHi(pHi, k2)
    const dn3Lo = shrLo(pLo, pHi, k3)
    const dn3Hi = shrHi(pHi, k3)

    let pairLo = upLo & up2Lo
    let pairHi = upHi & up2Hi
    rLo |= (pairLo & up3Lo) | (pairLo & dnLo)
    rHi |= (pairHi & up3Hi) | (pairHi & dnHi)

    pairLo = dnLo & dn2Lo
    pairHi = dnHi & dn2Hi
    rLo |= (pairLo & upLo) | (pairLo & dn3Lo)
    rHi |= (pairHi & upHi) | (pairHi & dn3Hi)
  }

  outLo = rLo & BOARD_LO & ~mLo
  outHi = rHi & BOARD_HI & ~mHi
}

export class Board {
  constructor(FEN = '') {
    this.init()
    this.FEN = FEN.trim().replaceAll(' ', '')
    this.FEN.split('').forEach((c) => this.doMove(Number(c) - 1))
  }

  init() {
    this.curLo = 0 // Steine des Spielers am Zug
    this.curHi = 0
    this.maskLo = 0 // alle Steine
    this.maskHi = 0
    this.cntMoves = 0
  }

  heightOf = (col) => {
    let n = 0
    while (n < ROWS && ((n + col * H1 < 32 ? this.maskLo & (1 << (n + col * H1)) : this.maskHi & (1 << (n + col * H1 - 32))) !== 0)) n++
    return n
  }

  canPlay = (col) => (this.maskLo & TOP_LO[col]) === 0 && (this.maskHi & TOP_HI[col]) === 0
  isDraw = () => this.cntMoves >= AREA

  // Der Zug ist das unterste freie Feld der Spalte: mask + bottom, auf die Spalte maskiert.
  moveBit = (col) => {
    add49(this.maskLo, this.maskHi, BOTTOM_LO, BOTTOM_HI)
    outLo &= COLUMN_LO[col]
    outHi &= COLUMN_HI[col]
  }

  doMoveBit = (bLo, bHi) => {
    this.curLo ^= this.maskLo
    this.curHi ^= this.maskHi
    this.maskLo |= bLo
    this.maskHi |= bHi
    this.cntMoves++
  }

  undoMoveBit = (bLo, bHi) => {
    this.maskLo &= ~bLo
    this.maskHi &= ~bHi
    this.curLo ^= this.maskLo
    this.curHi ^= this.maskHi
    this.cntMoves--
  }

  // Bequemer Einstieg fuer FEN und Tests, nicht im Suchkern - die Pruefung kostet dort
  // nichts. Ohne sie liefert eine volle Spalte das Zug-Bit 0, und doMoveBit vertauscht dann
  // den Spieler am Zug, ohne einen Stein zu setzen: die Stellung waere still verfaelscht.
  doMove = (col) => {
    if (!this.canPlay(col)) throw new Error(`Spalte ${col + 1} ist voll`)
    this.moveBit(col)
    this.doMoveBit(outLo, outHi)
  }

  // Gewinnt der Spieler am Zug, wenn er in dieser Spalte setzt?
  isWinningMove = (col) => {
    computeWinning(this.curLo, this.curHi, this.maskLo, this.maskHi)
    const wLo = outLo
    const wHi = outHi
    this.moveBit(col)
    return ((wLo & outLo) | (wHi & outHi)) !== 0
  }

  // Eindeutiger 49-Bit-Schluessel der Stellung: current + mask + bottom. Zwei verschiedene
  // Stellungen koennen ihn nicht teilen, die TT verifiziert damit exakt statt nur wahrscheinlich.
  key = () => {
    add49(this.curLo, this.curHi, this.maskLo, this.maskHi)
    add49(outLo, outHi, BOTTOM_LO, BOTTOM_HI)
  }

  // Stellung und Spiegelbild haben denselben Wert, teilen sich hier also einen TT-Eintrag.
  // Kanonisch ist der kleinere der beiden Schluessel; der Rueckgabewert sagt, ob gespiegelt
  // wurde - dann gehoert auch der gespeicherte beste Zug zur gespiegelten Orientierung.
  canonicalKey = () => {
    this.key()
    const kLo = outLo
    const kHi = outHi
    mirror49(this.curLo, this.curHi)
    const curLo = outLo
    const curHi = outHi
    mirror49(this.maskLo, this.maskHi)
    add49(curLo, curHi, outLo, outHi)
    add49(outLo, outHi, BOTTOM_LO, BOTTOM_HI)
    const hi = outHi >>> 0
    const khi = kHi >>> 0
    if (hi < khi || (hi === khi && (outLo >>> 0) < (kLo >>> 0))) return true
    outLo = kLo
    outHi = kHi
    return false
  }

  toString = () => {
    const at = (col, row) => {
      const b = col * H1 + row
      const inMask = b < 32 ? this.maskLo & (1 << b) : this.maskHi & (1 << (b - 32))
      if (!inMask) return ' _ '
      const inCur = b < 32 ? this.curLo & (1 << b) : this.curHi & (1 << (b - 32))
      // curLo gehoert dem Spieler am Zug; bei gerader Zugzahl ist das Spieler 0
      return (inCur !== 0) === (this.cntMoves % 2 === 0) ? ' X ' : ' O '
    }
    return range(ROWS).reduce((acc, r) => acc + range(COLS).reduce((line, c) => line + at(c, ROWS - 1 - r), '') + '\n', '')
  }
}

const winScore = (stones) => (AREA + 1 - stones) >> 1
const lossScore = (stones) => -((AREA - stones) >> 1)

const TT_FLAGS = { exact: 1, lower_bound: 2, upper_bound: 3 }

// Ein Eintrag steckt in zwei aufeinanderfolgenden 32-Bit-Woertern, also acht Bytes in einer
// Cache-Zeile. Vorher lag er ueber fuenf getrennte Arrays verteilt und eine Sondierung fasste
// fuenf Speicherbereiche an - gemessen ist die Suche cache- und nicht platzgebunden.
//   Wort 0: kLo (32 Bit)
//   Wort 1: kHi (Bit 0-16) | Score+32 (17-22) | Flag (23-24) | bester Zug (25-27)
const TT_SCORE_BIAS = 32

class TranspositionTable {
  constructor(bits) {
    this.mask = (1 << bits) - 1
    this.words = new Uint32Array((this.mask + 1) * 2)
  }

  // Index aus beiden Woertern gemischt, verifiziert wird aber gegen den vollen 49-Bit-
  // Schluessel - Falsch-Treffer sind damit ausgeschlossen, nicht nur unwahrscheinlich.
  index = (kLo, kHi) => ((Math.imul(kLo, 0x9e3779b1) ^ Math.imul(kHi, 0x85ebca77)) & this.mask) << 1

  store(kLo, kHi, score, flag, bestMove) {
    const i = this.index(kLo, kHi)
    this.words[i] = kLo
    this.words[i + 1] = (kHi & HI_MASK) | (((score + TT_SCORE_BIAS) | (flag << 6) | (bestMove << 8)) << 17)
    return score
  }

  probe(kLo, kHi, alpha, beta) {
    const i = this.index(kLo, kHi)
    if (this.words[i] !== kLo >>> 0) return null
    const w = this.words[i + 1]
    if ((w & HI_MASK) !== (kHi >>> 0)) return null
    const flag = (w >>> 23) & 3
    if (flag === 0) return null
    const score = ((w >>> 17) & 63) - TT_SCORE_BIAS
    if (flag === TT_FLAGS.exact) return score
    if (flag === TT_FLAGS.lower_bound && score >= beta) return score
    if (flag === TT_FLAGS.upper_bound && score <= alpha) return score
    return null
  }

  getBestMove(kLo, kHi) {
    const i = this.index(kLo, kHi)
    if (this.words[i] !== kLo >>> 0) return -1
    const w = this.words[i + 1]
    return (w & HI_MASK) === (kHi >>> 0) && (w >>> 23 & 3) !== 0 ? (w >>> 25) & 7 : -1
  }
}

const ttPool = new Map()
const getTranspositionTable = (bits = 22) => ttPool.get(bits) ?? ttPool.set(bits, new TranspositionTable(bits)).get(bits)
export const resetTranspositionTables = () => ttPool.clear()

// Eroeffnungsbuch, optional. Ist eines gesetzt, endet die Suche bei book.ply Steinen mit
// dem nachgeschlagenen exakten Score statt weiterzurechnen.
let openingBook = null
export const setBook = (book) => { openingBook = book }
export const getBook = () => openingBook

const SEARCH_ABORTED = Symbol('solver-aborted')
const TIME_CHECK_MASK = 1023
const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6]

class Solver {
  constructor(board, info, tt, timeOut) {
    this.board = board
    this.info = info
    this.tt = tt
    this.timeOut = timeOut
    // Ein Zugpuffer je Ebene, damit die Rekursion nichts alloziert.
    this.cols = Array.from({ length: AREA + 1 }, () => new Int32Array(COLS))
    this.bitsLo = Array.from({ length: AREA + 1 }, () => new Int32Array(COLS))
    this.bitsHi = Array.from({ length: AREA + 1 }, () => new Int32Array(COLS))
    this.scores = Array.from({ length: AREA + 1 }, () => new Int32Array(COLS))
  }

  // Sammelt die Zuege, die nicht sofort verlieren, und ordnet sie nach der Anzahl der
  // Drohungen, die sie erzeugen. Beides faellt aus derselben Bitrechnung ab.
  generate = (ply) => {
    const board = this.board
    // Gegnerposition = alle Steine ohne die eigenen
    const oppLo = board.curLo ^ board.maskLo
    const oppHi = board.curHi ^ board.maskHi

    add49(board.maskLo, board.maskHi, BOTTOM_LO, BOTTOM_HI)
    let possLo = outLo & BOARD_LO
    let possHi = outHi & BOARD_HI

    computeWinning(oppLo, oppHi, board.maskLo, board.maskHi)
    const oppWinLo = outLo
    const oppWinHi = outHi

    const forcedLo = possLo & oppWinLo
    const forcedHi = possHi & oppWinHi
    if ((forcedLo | forcedHi) !== 0) {
      // Mehr als eine Drohung laesst sich nicht blocken.
      if (popcount(forcedLo) + popcount(forcedHi) > 1) return -1
      possLo = forcedLo
      possHi = forcedHi
    }

    // Zuege streichen, die dem Gegner direkt darueber den Sieg schenken.
    possLo &= ~shrLo(oppWinLo, oppWinHi, 1)
    possHi &= ~shrHi(oppWinHi, 1)
    if ((possLo | possHi) === 0) return -1

    const cols = this.cols[ply]
    const bitsLo = this.bitsLo[ply]
    const bitsHi = this.bitsHi[ply]
    const scores = this.scores[ply]
    let n = 0

    for (const c of CENTER_ORDER) {
      const bLo = possLo & COLUMN_LO[c]
      const bHi = possHi & COLUMN_HI[c]
      if ((bLo | bHi) === 0) continue
      computeWinning(board.curLo | bLo, board.curHi | bHi, board.maskLo | bLo, board.maskHi | bHi)
      const score = popcount(outLo) + popcount(outHi)
      // Einfuegesortierung, absteigend nach erzeugten Drohungen
      let i = n++
      while (i > 0 && scores[i - 1] < score) {
        scores[i] = scores[i - 1]
        cols[i] = cols[i - 1]
        bitsLo[i] = bitsLo[i - 1]
        bitsHi[i] = bitsHi[i - 1]
        i--
      }
      scores[i] = score
      cols[i] = c
      bitsLo[i] = bLo
      bitsHi[i] = bHi
    }
    return n
  }

  negamax = (alpha, beta, ply = 0) => {
    if ((this.info.nodes & TIME_CHECK_MASK) === 0 && this.timeOut()) return SEARCH_ABORTED
    ++this.info.nodes

    const board = this.board
    const stones = board.cntMoves
    if (stones === AREA) return 0

    if (openingBook !== null && stones === openingBook.ply) {
      board.canonicalKey()
      const booked = lookupBook(openingBook, outLo, outHi)
      if (booked !== undefined) return booked
    }

    const n = this.generate(ply)
    if (n < 0) return lossScore(stones)
    if (stones >= AREA - 2) return 0

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

    const mirrored = board.canonicalKey()
    const kLo = outLo
    const kHi = outHi
    const cached = this.tt.probe(kLo, kHi, alpha, beta)
    if (cached !== null) return cached

    const originalAlpha = alpha
    const cols = this.cols[ply]
    const bitsLo = this.bitsLo[ply]
    const bitsHi = this.bitsHi[ply]
    const stored = this.tt.getBestMove(kLo, kHi)
    const ttMove = stored < 0 || !mirrored ? stored : COLS - 1 - stored
    let bestMove = cols[0]

    for (let i = -1; i < n; i++) {
      let idx = i
      if (i < 0) {
        if (ttMove < 0) continue
        idx = -1
        for (let j = 0; j < n; j++) if (cols[j] === ttMove) { idx = j; break }
        if (idx < 0) continue
      } else if (cols[i] === ttMove) continue

      const c = cols[idx]
      board.doMoveBit(bitsLo[idx], bitsHi[idx])
      const childScore = this.negamax(-beta, -alpha, ply + 1)
      board.undoMoveBit(bitsLo[idx], bitsHi[idx])
      if (childScore === SEARCH_ABORTED) return SEARCH_ABORTED

      const score = -childScore
      if (score >= beta) return this.tt.store(kLo, kHi, score, TT_FLAGS.lower_bound, mirrored ? COLS - 1 - c : c)
      if (score > alpha) {
        alpha = score
        bestMove = c
      }
    }

    return this.tt.store(kLo, kHi, alpha, alpha > originalAlpha ? TT_FLAGS.exact : TT_FLAGS.upper_bound, mirrored ? COLS - 1 - bestMove : bestMove)
  }
}

// Fuer den Buchgenerator: dieselbe Zugerzeugung wie in der Suche, damit das Buch genau die
// Stellungen enthaelt, die die Suche auch erreicht. Kein zweiter Codepfad.
// Der kanonische Schluessel liegt nach canonicalKey() in modulinternen Variablen; fuer den
// Buchgenerator wird er hier herausgereicht.
export const canonicalKeyOf = (board) => {
  const mirrored = board.canonicalKey()
  return { lo: outLo, hi: outHi, mirrored }
}

export const createMoveGenerator = () => {
  const solver = new Solver(null, { nodes: 0 }, null, () => false)
  return (board) => {
    solver.board = board
    const n = solver.generate(0)
    return { n, cols: solver.cols[0], bitsLo: solver.bitsLo[0], bitsHi: solver.bitsHi[0] }
  }
}

// Binaere Suche ueber den Score, jeder Schritt eine Suche mit leerem Fenster.
export const solve = (board, opts = {}) => {
  const settings = { maxThinkingTime: 60000, ttBits: 22, ...opts }
  const start = performance.now()
  const info = { nodes: 0, stopAt: Date.now() + settings.maxThinkingTime }
  const timeOut = () => Date.now() >= info.stopAt
  const solver = new Solver(board, info, getTranspositionTable(settings.ttBits), timeOut)

  // negamax setzt voraus, dass der Spieler am Zug nicht sofort gewinnen kann. Innerhalb der
  // Suche halten das die Kinder aus generate() ein, an der Wurzel muss es geprueft werden -
  // sonst wird der Gewinnzug gespielt und die entstandene Viererreihe nie bemerkt.
  if (CENTER_ORDER.some((c) => board.canPlay(c) && board.isWinningMove(c))) {
    const score = winScore(board.cntMoves)
    return { score, min: score, max: score, solved: true, nodes: 0, elapsedTime: ((performance.now() - start) / 1000).toFixed(3) }
  }

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

let moveGenerator = null

export const findBestMove = (board, opts = {}) => {
  const start = performance.now()
  const seconds = () => ((performance.now() - start) / 1000).toFixed(3)
  const deadline = Date.now() + (opts.maxThinkingTime ?? 60000)
  const playable = CENTER_ORDER.filter((c) => board.canPlay(c))

  const winner = playable.find((c) => board.isWinningMove(c))
  if (winner !== undefined) return { bestMove: winner, score: winScore(board.cntMoves), solved: true, nodes: 0, elapsedTime: seconds() }

  // Zugliste in der Ordnung der Suche: nicht sofort verlierende Zuege zuerst, sortiert nach
  // erzeugten Drohungen. Reicht die Zeit nicht fuer alle, ist der erste die beste Schaetzung.
  moveGenerator ??= createMoveGenerator()
  const { n, cols } = moveGenerator(board)
  if (n < 0) return { bestMove: playable[0], score: lossScore(board.cntMoves), solved: true, nodes: 0, elapsedTime: seconds() }
  const order = Array.from({ length: n }, (_, i) => cols[i])

  let best = order[0]
  let bestScore = -Infinity
  let nodes = 0
  let solved = true

  for (const c of order) {
    // Restbudget statt vollem Budget je Zug, sonst dauert die Wurzel ein Vielfaches davon.
    const left = deadline - Date.now()
    if (left <= 0) {
      solved = false
      break
    }
    board.moveBit(c)
    const bLo = outLo
    const bHi = outHi
    board.doMoveBit(bLo, bHi)
    const r = solve(board, { ...opts, maxThinkingTime: left })
    board.undoMoveBit(bLo, bHi)
    nodes += r.nodes
    if (!r.solved) {
      solved = false
      continue
    }
    if (-r.score > bestScore) {
      bestScore = -r.score
      best = c
    }
  }

  return { bestMove: best, score: bestScore === -Infinity ? undefined : bestScore, solved, nodes, elapsedTime: seconds() }
}
