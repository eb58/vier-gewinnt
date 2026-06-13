const range = (n) => [...Array(n).keys()]
const timer = (start = performance.now()) => ({ elapsedTime: () => ((performance.now() - start) / 1000).toFixed(3) })

const NN = (1 << 23) - 1
const MAXVAL = 100
export const COLS = 7
export const ROWS = 6

const TT_FLAGS = { exact: 1, lower_bound: 2, upper_bound: 3 }

class TranspositionTable {
  getTTSizeForDepth = (depth) => (1 << (depth >= 30 ? 28 : depth >= 36 ? 26 : depth >= 18 ? 23 : 20)) - 1

  constructor(depth) {
    this.size = this.getTTSizeForDepth(depth)
    this.keys = new Uint32Array(this.size)
    this.scores = new Int8Array(this.size)
    this.depths = new Int8Array(this.size)
    this.flags = new Int8Array(this.size)
  }

  store(hash, depth, score, flag) {
    score = score === -0 ? 0 : score
    this.keys[hash & this.size] = hash
    this.depths[hash & this.size] = depth
    this.scores[hash & this.size] = score
    this.flags[hash & this.size] = flag
    return score
  }

  getScore(hash, depth, alpha, beta) {
    if (this.keys[hash & this.size] === hash && this.depths[hash & this.size] >= depth) {
      const score = this.scores[hash & this.size]
      const flag = this.flags[hash & this.size]
      if (flag === TT_FLAGS.exact) return score
      if (flag === TT_FLAGS.lower_bound && score >= beta) return score
      if (flag === TT_FLAGS.upper_bound && score <= alpha) return score
    }
    return null
  }
}

const pieceKeys = [
  227019481, 1754434862, 629481213, 887205851, 529032562, 2067323277, 1070040335, 567190488, 468610655, 1669182959, 236891527, 1211317841, 849223426, 1031915473, 315781957,
  1594703270, 114113554, 966088184, 2114417493, 340442843, 410051610, 1895709998, 502837645, 2046296443, 1720231708, 1437032187, 80592865, 1757570123, 2063094472, 1123905671,
  901800952, 1894943568, 732390329, 401463737, 2055893758, 1688751506, 115630249, 391883254, 249795256, 1341740832, 807352454, 2122692086, 851678180, 1154773536, 64453931,
  311845715, 1173309830, 1855940732, 1662371745, 998042207, 2121332908, 1905657426, 873276463, 1048910740, 1181863470, 136324833, 881754029, 1037297764, 1385633069, 2037058967,
  398045724, 1522858950, 1892619084, 1364648567, 771375215, 983991136, 260316522, 648466817, 1502780386, 1733680598, 401803338, 2136229086, 718267066, 485772484, 1936892066,
  1051148609, 1018878751, 1721684837, 1720651398, 2073094346, 526823540, 1170625524, 465996760, 1587572180
]

export class Board {
  Player = { ai: 0, hp: 1 }
  heightCols

  init(player = this.Player.ai) {
    this.heightCols = new Uint32Array(COLS)
    this.currentPlayer = player
    this.cntMoves = 0
    this.bitboards = [new Uint32Array(2), new Uint32Array(2)]
    this.hash = 0
  }

  constructor(FEN = '') {
    this.init()
    this.FEN = FEN.trim().replaceAll(' ', '')
    this.FEN.split('').forEach((c) => this.doMove(c - 1))
  }

  doMove = (c) => {
    const idx = c + COLS * this.heightCols[c]
    this.hash ^= pieceKeys[this.currentPlayer ? idx : idx + 42]
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
    this.hash ^= pieceKeys[this.currentPlayer ? idx : idx + 42]
    this.bitboards[this.currentPlayer][idx < 32 ? 0 : 1] &= ~(1 << (idx < 32 ? idx : idx - 32))
  }

  checkWinForColumn = (c) => this.checkWinning(c, this.currentPlayer)

  checkWinning = (col, player) => {
    const row = this.heightCols[col]
    if (row >= ROWS) return false

    const bb = this.bitboards[player]
    const bbLo = bb[0]
    const bbHi = bb[1]
    const has = (idx) => (idx < 32 ? bbLo & (1 << idx) : bbHi & (1 << (idx - 32)))

    for (let count = 1, r = row - 1; r >= 0 && has(r * COLS + col); r--) if (++count >= 4) return true

    let count = 1
    for (let c = col - 1; c >= 0 && has(row * COLS + c); c--) if (++count >= 4) return true
    for (let c = col + 1; c < COLS && has(row * COLS + c); c++) if (++count >= 4) return true

    count = 1
    for (let r = row - 1, c = col - 1; c >= 0 && r >= 0 && has(r * COLS + c); r--, c--) if (++count >= 4) return true
    for (let r = row + 1, c = col + 1; c < COLS && r < ROWS && has(r * COLS + c); r++, c++) if (++count >= 4) return true

    count = 1
    for (let r = row - 1, c = col + 1; c < COLS && r >= 0 && has(r * COLS + c); r--, c++) if (++count >= 4) return true
    for (let r = row + 1, c = col - 1; c >= 0 && r < ROWS && has(r * COLS + c); r++, c--) if (++count >= 4) return true

    return false
  }

  findWinningColumn = (columns, player) => {
    for (const c of columns) if (this.heightCols[c] < ROWS && this.checkWinning(c, player)) return c
    return null
  }

  findWinningColumnForCurrentPlayer = (columns) => this.findWinningColumn(columns, this.currentPlayer)
  findWinningColumnForOpponentPlayer = (columns) => this.findWinningColumn(columns, 1 - this.currentPlayer)

  toString = () => {
    const bb = this.bitboards
    const has = (bb, idx) => (idx < 32 ? bb[0] & (1 << idx) : bb[1] & (1 << (idx - 32)))
    const symbol = (idx) => (has(bb[0], idx) ? ' X ' : has(bb[1], idx) ? ' O ' : ' _ ')
    return range(ROWS).reduce((a, r) => a + range(COLS).reduce((a, c) => a + symbol((ROWS - r - 1) * COLS + c), '') + '\n', '')
  }

  print = () => console.log('FEN:', this.FEN, '\n', this.toString().trim())
}

class CfEngine {
  constructor(board, searchInfo, tt) {
    this.tt = tt
    this.board = board
    this.searchInfo = searchInfo
  }

  negamax = (columns, depth, alpha, beta, root = false) => {
    const cachedScore = this.tt.getScore(this.board.hash, depth, alpha, beta)
    if (cachedScore !== null) return cachedScore

    if (depth === 0 || this.board.cntMoves === 42) return 0

    ++this.searchInfo.nodes

    for (const c of columns)
      if (this.board.checkWinForColumn(c)) {
        if (root) this.searchInfo.bestMove = c
        return this.tt.store(this.board.hash, depth, MAXVAL, TT_FLAGS.exact)
      }

    for (const c of columns)
      if (this.board.heightCols[c] < ROWS) {
        this.board.doMove(c)
        const score = -this.negamax(columns, depth - 1, -beta, -alpha)
        this.board.undoMove(c)
        if (root && this.searchInfo.bestMove === undefined) this.searchInfo.bestMove = c
        if (score > alpha) {
          alpha = score
          if (root) this.searchInfo.bestMove = c
        }
        if (alpha >= beta) return this.tt.store(this.board.hash, depth, alpha, TT_FLAGS.lower_bound)
      }
    return this.tt.store(this.board.hash, depth, alpha, TT_FLAGS.upper_bound)
  }
}

export const findBestMove = (board, opts) => {
  const t = timer()
  opts = { maxThinkingTime: 1000, minDepth: 1, maxDepth: 42 - board.cntMoves, ...opts }
  const searchInfo = { nodes: 0, stopAt: Date.now() + opts.maxThinkingTime }
  const timeOut = () => Date.now() >= searchInfo.stopAt
  const columns = [3, 2, 4, 1, 5, 0, 6].filter((c) => board.heightCols[c] < ROWS)

  for (let depth = opts.minDepth; depth <= opts.maxDepth; depth++) {
    const tt = new TranspositionTable(depth)
    const cf = new CfEngine(board, searchInfo, tt)
    searchInfo.depth = depth
    searchInfo.score = cf.negamax(columns, depth, -MAXVAL, MAXVAL, true)
    const timedOut = timeOut()
    opts.onDepth?.({ ...searchInfo, elapsedTime: t.elapsedTime(), columns: [...columns], timedOut })
    if (searchInfo.score || timedOut) break
  }
  return { ...searchInfo, elapsedTime: t.elapsedTime() }
}
