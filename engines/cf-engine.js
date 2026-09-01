const range = (n) => [...Array(n).keys()]
const timer = (start = performance.now()) => ({ elapsedTime: () => ((performance.now() - start) / 1000).toFixed(3) })

// Weit oberhalb jeder Stellungsbewertung, damit ein bewiesenes Ergebnis nie mit einem
// Schätzwert verwechselt werden kann. |score| === MAXVAL heisst "bewiesen".
export const MAXVAL = 10000
export const COLS = 7
export const ROWS = 6
const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6]
const TT_MOVE_ORDERS = range(COLS).map((move) => [move, ...CENTER_ORDER.filter((col) => col !== move)])
const SINGLE_COLUMNS = range(COLS).map((col) => [col]) // vorab, damit ein erzwungener Zug keine Allokation pro Knoten kostet
const NO_THREAT = -1
const MULTI_THREAT = -2
const SEARCH_ABORTED = Symbol('search-aborted')
const TIME_CHECK_MASK = 1023

// Die 69 Viererlinien, je Zelle indiziert (CSR-Layout). Gespeichert wird pro Linie nur die
// Maske der ANDEREN drei Zellen - die fallende Zelle steckt per Konstruktion in jeder Linie
// durch sie, die Prüfung ist damit ein blosses (bb & maske) === maske.
// Int32Array, nicht Uint32Array: Bit 31 muss als negativer int32 zurückkommen, sonst
// scheitert der Vergleich gegen das int32-Ergebnis von `&`.
const inBoard = ([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS
const WIN_LINES = range(ROWS).flatMap((r) => range(COLS).flatMap((c) => [[0, 1], [1, 0], [1, 1], [1, -1]]
  .map((d) => range(4).map((k) => [r + k * d[0], c + k * d[1]]))
  .filter((cells) => cells.every(inBoard))
  .map((cells) => cells.map(([rr, cc]) => rr * COLS + cc))))
const restLines = range(COLS * ROWS).map((idx) => WIN_LINES.filter((line) => line.includes(idx)).map((line) => line.filter((i) => i !== idx)))
const WIN_START = Uint16Array.from(restLines.reduce((acc, lines) => [...acc, acc[acc.length - 1] + lines.length], [0]))
const WIN_LO = Int32Array.from(restLines.flat(), (rest) => rest.reduce((m, i) => i < 32 ? m | (1 << i) : m, 0))
const WIN_HI = Int32Array.from(restLines.flat(), (rest) => rest.reduce((m, i) => i < 32 ? m : m | (1 << (i - 32)), 0))

// Zweiter Index über dieselben Linien, diesmal Zelle -> Linien-IDs. Damit lässt sich die
// Bewertung inkrementell führen: ein Stein berührt nur die Linien durch seine Zelle (max 13),
// statt bei jeder Blattbewertung alle 69 neu zu zählen.
const NUM_LINES = WIN_LINES.length
const cellLines = range(COLS * ROWS).map((idx) => range(NUM_LINES).filter((line) => WIN_LINES[line].includes(idx)))
const CELL_LINE_START = Uint16Array.from(cellLines.reduce((acc, lines) => [...acc, acc[acc.length - 1] + lines.length], [0]))
const CELL_LINES = Uint8Array.from(cellLines.flat())

// Wert einer Linie nach Besetzung: gemischte Linien sind tot, sonst wächst der Wert steil
// mit der Anzahl eigener Steine. Indiziert mit anzahlSpieler0 * 5 + anzahlSpieler1.
const LINE_WEIGHTS = [0, 1, 4, 16, 64]
const LINE_VALUE = Int16Array.from(range(25), (i) => {
  const a = (i / 5) | 0
  const b = i % 5
  return a && b ? 0 : a ? LINE_WEIGHTS[a] : -LINE_WEIGHTS[b]
})

const TT_FLAGS = { exact: 1, lower_bound: 2, upper_bound: 3 }

class TranspositionTable {
  constructor(bits) {
    this.mask = (1 << bits) - 1
    this.keys = new Uint32Array(this.mask + 1)
    this.scores = new Int16Array(this.mask + 1) // Int8 reicht seit der Bewertung nicht mehr
    this.depths = new Int8Array(this.mask + 1)
    this.flags = new Int8Array(this.mask + 1)
    this.bestMoves = new Uint8Array(this.mask + 1)
  }

  index = (hash) => hash & this.mask

  store(hash, lock, depth, score, flag, bestMove = -1) {
    const idx = this.index(hash)
    const normalizedScore = score === -0 ? 0 : score
    this.keys[idx] = lock
    this.depths[idx] = depth
    this.scores[idx] = normalizedScore
    this.flags[idx] = flag
    this.bestMoves[idx] = Number.isInteger(bestMove) && bestMove >= 0 ? bestMove + 1 : 0
    return normalizedScore
  }

  getScore(hash, lock, depth, alpha, beta) {
    const idx = this.index(hash)
    if (this.keys[idx] !== lock || this.flags[idx] === 0 || this.depths[idx] < depth) return null

    const score = this.scores[idx]
    const flag = this.flags[idx]
    if (flag === TT_FLAGS.exact) return score
    if (flag === TT_FLAGS.lower_bound && score >= beta) return score
    if (flag === TT_FLAGS.upper_bound && score <= alpha) return score
    return null
  }

  getBestMove(hash, lock) {
    const idx = this.index(hash)
    return this.keys[idx] === lock && this.bestMoves[idx] > 0 ? this.bestMoves[idx] - 1 : null
  }
}

// Tabellen leben über die einzelne Suche hinaus. Nicht wegen der Allokation (die ist faul
// und kostet <1 ms), sondern weil aufeinanderfolgende Züge derselben Partie grösstenteils
// dieselben Stellungen durchsuchen: gemessen ~2,3x weniger Knoten über eine Partie.
const ttPool = new Map()
const getTranspositionTable = (depth, bits = depth >= 18 ? 23 : 20) => ttPool.get(bits) ?? ttPool.set(bits, new TranspositionTable(bits)).get(bits)
export const resetTranspositionTables = () => ttPool.clear()

const pieceKeys = [
  227019481, 1754434862, 629481213, 887205851, 529032562, 2067323277, 1070040335, 567190488, 468610655, 1669182959, 236891527, 1211317841, 849223426, 1031915473, 315781957,
  1594703270, 114113554, 966088184, 2114417493, 340442843, 410051610, 1895709998, 502837645, 2046296443, 1720231708, 1437032187, 80592865, 1757570123, 2063094472, 1123905671,
  901800952, 1894943568, 732390329, 401463737, 2055893758, 1688751506, 115630249, 391883254, 249795256, 1341740832, 807352454, 2122692086, 851678180, 1154773536, 64453931,
  311845715, 1173309830, 1855940732, 1662371745, 998042207, 2121332908, 1905657426, 873276463, 1048910740, 1181863470, 136324833, 881754029, 1037297764, 1385633069, 2037058967,
  398045724, 1522858950, 1892619084, 1364648567, 771375215, 983991136, 260316522, 648466817, 1502780386, 1733680598, 401803338, 2136229086, 718267066, 485772484, 1936892066,
  1051148609, 1018878751, 1721684837, 1720651398, 2073094346, 526823540, 1170625524, 465996760, 1587572180
]

// Zweiter, unabhängiger Zobrist-Satz. Der erste Hash liefert nur den Bucket-Index, dieser
// den gespeicherten Key: sonst verifizieren bei 2^23 Buckets nur 9 Restbits, also ~1/512
// Falsch-Treffer pro Sondierung auf belegtem Bucket.
const lockKeys = [
  637637689, 815774105, 522435376, 1382770672, 176808096, 1082756127, 640494288, 989678737, 1710869636, 1624947436, 1250278506, 1181910015, 1027416654, 2093159984, 1409496923,
  177382496, 788099594, 2106380381, 204025719, 222661944, 1369326064, 834945561, 1664780079, 662311229, 1627990383, 1774208738, 1607632385, 467829221, 1532649267, 38321525,
  1850739995, 2145168487, 367158246, 879210716, 356867219, 58799315, 678791295, 994565155, 679797228, 1976485843, 121580149, 2115473843, 1583647628, 1909191142, 1831444082,
  772769105, 239815290, 1292322313, 1541865502, 1640096157, 120290299, 2317569, 2056805492, 608345348, 1234407694, 1950175775, 1298477673, 2007607794, 1902263936, 550083005,
  1622607389, 172665067, 1604513117, 1672548111, 1921691088, 1252593666, 814751769, 148205938, 1736292765, 1350697608, 1646074848, 1941018086, 1426583153, 375023523, 101081795,
  1401335868, 1398781580, 1903072584, 978350794, 855221278, 1534393448, 315310072, 1073447366, 2040036757
]

// Ohne Seitenschlüssel wäre der Hash mehrdeutig: dieselbe Steinverteilung kann je nach
// Startspieler mit unterschiedlichem Spieler am Zug auftreten. Beide müssen < 2^31 bleiben,
// damit Hash und Lock nicht negativ werden und der Uint32Array-Vergleich trägt.
const SIDE_KEY = 1836311903
const SIDE_LOCK = 2065514873

export class Board {
  Player = { ai: 0, hp: 1 }
  heightCols

  init(player = this.Player.ai) {
    this.heightCols = new Uint32Array(COLS)
    this.currentPlayer = player
    this.cntMoves = 0
    this.bitboards = [new Uint32Array(2), new Uint32Array(2)]
    this.hash = player ? SIDE_KEY : 0
    this.lock = player ? SIDE_LOCK : 0
    this.lineCounts = new Uint8Array(2 * NUM_LINES)
    this.evalScore = 0 // immer aus Sicht von Spieler 0
  }

  constructor(FEN = '') {
    this.init()
    this.FEN = FEN.trim().replaceAll(' ', '')
    this.FEN.split('').forEach((c) => this.doMove(Number(c) - 1))
  }

  doMove = (c) => {
    const idx = c + COLS * this.heightCols[c]
    const keyIdx = this.currentPlayer ? idx : idx + 42
    this.hash ^= pieceKeys[keyIdx] ^ SIDE_KEY
    this.lock ^= lockKeys[keyIdx] ^ SIDE_LOCK
    this.updateLines(idx, this.currentPlayer, 1)
    this.bitboards[this.currentPlayer][idx < 32 ? 0 : 1] |= 1 << (idx < 32 ? idx : idx - 32)
    this.cntMoves++
    this.currentPlayer = 1 - this.currentPlayer
    this.heightCols[c]++
  }

  undoMove = (c) => {
    this.cntMoves--
    this.currentPlayer = 1 - this.currentPlayer
    this.heightCols[c]--
    const idx = c + COLS * this.heightCols[c]
    const keyIdx = this.currentPlayer ? idx : idx + 42
    this.hash ^= pieceKeys[keyIdx] ^ SIDE_KEY
    this.lock ^= lockKeys[keyIdx] ^ SIDE_LOCK
    this.updateLines(idx, this.currentPlayer, -1)
    this.bitboards[this.currentPlayer][idx < 32 ? 0 : 1] &= ~(1 << (idx < 32 ? idx : idx - 32))
  }

  // Nur die Linien durch idx ändern sich. Für jede wird ihr alter Wert abgezogen und der
  // neue addiert, damit evalScore ohne Vollzählung mitläuft. delta ist +1 beim Setzen,
  // -1 beim Zurücknehmen, was die Änderung exakt umkehrt.
  updateLines = (idx, player, delta) => {
    const counts = this.lineCounts
    const base = player * NUM_LINES
    for (let i = CELL_LINE_START[idx], end = CELL_LINE_START[idx + 1]; i < end; i++) {
      const line = CELL_LINES[i]
      this.evalScore -= LINE_VALUE[counts[line] * 5 + counts[NUM_LINES + line]]
      counts[base + line] += delta
      this.evalScore += LINE_VALUE[counts[line] * 5 + counts[NUM_LINES + line]]
    }
  }

  // Aus Sicht des Spielers am Zug. Die Fallunterscheidung hält 0 bei 0 statt bei -0,
  // was sonst Math.sign und Object.is-Vergleiche stolpern lässt.
  evaluation = () => this.currentPlayer && this.evalScore ? -this.evalScore : this.evalScore

  checkWinForColumn = (c) => this.checkWinning(c, this.currentPlayer)
  getHeightOfCol = (c) => this.heightCols[c]
  opponentPlayer = () => 1 - this.currentPlayer
  isDraw = () => this.cntMoves >= COLS * ROWS

  checkWinning = (col, player) => {
    const row = this.heightCols[col]
    if (row >= ROWS) return false

    const bb = this.bitboards[player]
    const bbLo = bb[0]
    const bbHi = bb[1]
    const idx = row * COLS + col

    for (let i = WIN_START[idx], end = WIN_START[idx + 1]; i < end; i++) {
      const lo = WIN_LO[i]
      const hi = WIN_HI[i]
      if ((bbLo & lo) === lo && (bbHi & hi) === hi) return true
    }
    return false
  }

  findWinningColumn = (columns, player) => {
    for (const c of columns) if (this.heightCols[c] < ROWS && this.checkWinning(c, player)) return c
    return null
  }

  findWinningColumnForCurrentPlayer = (columns) => this.findWinningColumn(columns, this.currentPlayer)
  findWinningColumnForOpponentPlayer = (columns) => this.findWinningColumn(columns, 1 - this.currentPlayer)

  // NO_THREAT, MULTI_THREAT oder die einzige Spalte, in der `player` sofort gewinnt.
  // Anders als findWinningColumn muss hier bis zum Ende gezählt werden.
  findSingleWinningColumn = (columns, player) => {
    let found = NO_THREAT
    for (const c of columns) {
      if (this.heightCols[c] >= ROWS || !this.checkWinning(c, player)) continue
      if (found !== NO_THREAT) return MULTI_THREAT
      found = c
    }
    return found
  }

  toString = () => {
    const bb = this.bitboards
    const has = (player, idx) => (idx < 32 ? bb[player][0] & (1 << idx) : bb[player][1] & (1 << (idx - 32)))
    const symbol = (idx) => (has(0, idx) ? ' X ' : has(1, idx) ? ' O ' : ' _ ')
    return range(ROWS).reduce((acc, row) => acc + range(COLS).reduce((line, col) => line + symbol((ROWS - row - 1) * COLS + col), '') + '\n', '')
  }

  print = () => console.log('FEN:', this.FEN, '\n', this.toString().trim())
}

class CfEngine {
  constructor(board, searchInfo, tt, useBestMove, timeOut) {
    this.tt = tt
    this.board = board
    this.searchInfo = searchInfo
    this.useBestMove = useBestMove
    this.timeOut = timeOut
  }

  // lastMove ist die Spalte, mit der dieser Knoten betreten wurde. Der Elternknoten hat
  // dort bereits die vollständige Sofortgewinn-Menge des jetzt Ziehenden bestimmt und
  // rekursiert nur, wenn sie leer war oder aus genau lastMove bestand. Seither haben sich
  // nur heightCols[lastMove] und die Steine des Gegners geändert - letztere können dem
  // jetzt Ziehenden keinen Gewinn verschaffen. Also genügt hier diese eine Spalte.
  negamax = (columns, depth, alpha, beta, root = false, lastMove = -1) => {
    if ((this.searchInfo.nodes & TIME_CHECK_MASK) === 0 && this.timeOut()) return SEARCH_ABORTED

    const hash = this.board.hash
    const lock = this.board.lock
    const cachedScore = this.tt.getScore(hash, lock, depth, alpha, beta)
    if (cachedScore !== null) {
      if (!root) return cachedScore
      // An der Wurzel darf ein Treffer nur greifen, wenn er auch einen Zug liefert -
      // sonst käme ein Score ohne bestMove zurück.
      const ttBest = this.tt.getBestMove(hash, lock)
      if (Number.isInteger(ttBest)) {
        this.searchInfo.bestMove = ttBest
        return cachedScore
      }
    }

    if (this.board.cntMoves === COLS * ROWS) return 0
    if (depth === 0) return this.board.evaluation()

    ++this.searchInfo.nodes

    const originalAlpha = alpha
    const winningMove = root
      ? this.board.findWinningColumnForCurrentPlayer(columns)
      : this.board.checkWinning(lastMove, this.board.currentPlayer) ? lastMove : null
    if (Number.isInteger(winningMove)) {
      if (root) this.searchInfo.bestMove = winningMove
      return this.tt.store(hash, lock, depth, MAXVAL, TT_FLAGS.exact, winningMove)
    }

    const threat = this.board.findSingleWinningColumn(columns, this.board.opponentPlayer())
    // Zwei Drohungen lassen sich nicht beide blocken, und einen eigenen Sofortgewinn
    // hätte der Zweig darüber schon gefunden - die Stellung ist verloren. An der Wurzel
    // kostet das Nachschlagen der Blockspalte einen Scan, liefert aber einen bestMove.
    if (threat === MULTI_THREAT) {
      const block = root ? this.board.findWinningColumnForOpponentPlayer(columns) : -1
      if (root) this.searchInfo.bestMove = block
      return this.tt.store(hash, lock, depth, -MAXVAL, TT_FLAGS.exact, block)
    }

    let bestMove = -1
    const ttMove = this.useBestMove ? this.tt.getBestMove(hash, lock) : null
    // Bei genau einer Drohung verliert jeder Zug ausser dem Block sofort.
    const searchColumns = threat !== NO_THREAT ? SINGLE_COLUMNS[threat] : Number.isInteger(ttMove) ? TT_MOVE_ORDERS[ttMove] : columns
    for (const c of searchColumns) {
      if (this.board.heightCols[c] >= ROWS) continue
      this.board.doMove(c)
      const childScore = this.negamax(columns, depth - 1, -beta, -alpha, false, c)
      this.board.undoMove(c)
      if (childScore === SEARCH_ABORTED) return SEARCH_ABORTED

      const score = -childScore
      if (bestMove < 0) {
        bestMove = c
        if (root) this.searchInfo.bestMove = c
      }
      if (score > alpha) {
        alpha = score
        bestMove = c
        if (root) this.searchInfo.bestMove = c
      }
      if (alpha >= beta) return this.tt.store(hash, lock, depth, alpha, TT_FLAGS.lower_bound, c)
    }

    const flag = alpha > originalAlpha ? TT_FLAGS.exact : TT_FLAGS.upper_bound
    return this.tt.store(hash, lock, depth, alpha, flag, bestMove)
  }
}

export const findBestMove = (board, opts) => {
  const t = timer()
  const settings = { maxThinkingTime: 1000, minDepth: 1, maxDepth: COLS * ROWS - board.cntMoves, ...opts }
  const searchInfo = { nodes: 0, stopAt: Date.now() + settings.maxThinkingTime }
  const timeOut = () => Date.now() >= searchInfo.stopAt
  const columns = CENTER_ORDER.filter((c) => board.heightCols[c] < ROWS)
  const useIterativeBestMove = settings.maxDepth > settings.minDepth
  const tt = getTranspositionTable(settings.maxDepth)
  const completed = { depth: 0, score: 0, bestMove: undefined }

  for (const depth of range(settings.maxDepth - settings.minDepth + 1).map((i) => i + settings.minDepth)) {
    if (timeOut()) {
      searchInfo.timedOut = true
      break
    }

    const cf = new CfEngine(board, searchInfo, tt, useIterativeBestMove && depth > settings.minDepth, timeOut)
    searchInfo.depth = depth
    const score = cf.negamax(columns, depth, -MAXVAL, MAXVAL, true)
    if (score === SEARCH_ABORTED) {
      searchInfo.depth = completed.depth
      searchInfo.score = completed.score
      searchInfo.bestMove = completed.bestMove
      searchInfo.timedOut = true
      settings.onDepth?.({ ...searchInfo, elapsedTime: t.elapsedTime(), columns: [...columns], attemptedDepth: depth })
      break
    }

    searchInfo.score = score
    const timedOut = timeOut()
    searchInfo.timedOut = timedOut
    completed.depth = depth
    completed.score = score
    completed.bestMove = searchInfo.bestMove
    settings.onDepth?.({ ...searchInfo, elapsedTime: t.elapsedTime(), columns: [...columns], timedOut })
    // Nur ein bewiesenes Ergebnis beendet die Vertiefung. Vor der Bewertung war jeder Wert
    // ungleich 0 gleichbedeutend damit; jetzt sind die meisten Werte blosse Schätzungen.
    if (Math.abs(searchInfo.score) === MAXVAL || timedOut) break
  }
  return { ...searchInfo, elapsedTime: t.elapsedTime() }
}
