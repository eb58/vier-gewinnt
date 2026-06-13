import { Board, COLS, ROWS, findBestMove } from './cf-engine.js'

const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const range = (n) => [...Array(n).keys()]
const HUMAN = 1
const AI = 0
const state = {
  board: new Board(),
  locked: false,
  gameOver: false,
  scores: { human: 0, ai: 0 },
  moves: [],
  winningCells: [],
  hoverCol: null,
  hintCol: null,
  engineInfo: null
}

const els = {
  board: $('#board'),
  columnPicker: $('#columnPicker'),
  statusBar: $('#statusBar'),
  statusTitle: $('#statusTitle'),
  statusMeta: $('#statusMeta'),
  turnPill: $('#turnPill'),
  engineBadge: $('#engineBadge'),
  newGame: $('#newGame'),
  resultNewGame: $('#resultNewGame'),
  undoMove: $('#undoMove'),
  hintMove: $('#hintMove'),
  aiStarts: $('#aiStarts'),
  humanScore: $('#humanScore'),
  aiScore: $('#aiScore'),
  moveCount: $('#moveCount'),
  difficultyPicker: $('#difficultyPicker'),
  difficultyLabel: $('#difficultyLabel'),
  lastAiMove: $('#lastAiMove'),
  depthStat: $('#depthStat'),
  nodesStat: $('#nodesStat'),
  result: $('#result'),
  resultToken: $('#resultToken'),
  resultTitle: $('#resultTitle'),
  resultText: $('#resultText'),
  confetti: $('#confetti')
}

const hasPiece = (player, idx) => {
  const bitboard = state.board.bitboards[player]
  return Boolean(idx < 32 ? bitboard[0] & (1 << idx) : bitboard[1] & (1 << (idx - 32)))
}

const cellPlayer = (row, col) => {
  const idx = (ROWS - row - 1) * COLS + col
  if (hasPiece(HUMAN, idx)) return 'human'
  if (hasPiece(AI, idx)) return 'ai'
  return ''
}

const activeDifficulty = () => {
  const active = $('.segment.active')
  return {
    label: active.dataset.label,
    time: Number(active.dataset.time),
    depth: Number(active.dataset.depth)
  }
}

const setStatus = (title, meta = '', tone = '') => {
  els.statusTitle.textContent = title
  els.statusMeta.textContent = meta
  els.statusBar.className = `status-bar ${tone}`.trim()
}

const setTurn = () => {
  const text = state.gameOver ? 'Runde beendet' : state.board.currentPlayer === HUMAN ? 'Du bist dran' : 'KI denkt'
  const tone = state.gameOver ? 'done-turn' : state.board.currentPlayer === HUMAN ? 'human-turn' : 'ai-turn'
  els.turnPill.textContent = text
  els.turnPill.className = `turn-pill ${tone}`
}

const validColumn = (col) => Number.isInteger(col) && col >= 0 && col < COLS

const columnFromPoint = (event) => {
  const cell = event.target.closest('.cell')
  if (cell && els.board.contains(cell)) return Number(cell.dataset.col)

  const rect = els.board.getBoundingClientRect()
  const x = event.clientX - rect.left
  if (x < 0 || x > rect.width) return null
  return Math.min(COLS - 1, Math.max(0, Math.floor((x / rect.width) * COLS)))
}

const formatNodes = (nodes) => nodes >= 1000000 ? `${(nodes / 1000000).toFixed(1)}M` : nodes >= 1000 ? `${Math.round(nodes / 1000)}k` : `${nodes ?? '-'}`

const winningCellsForMove = (col, player) => {
  const row = state.board.heightCols[col] - 1
  const lines = [
    [[0, 1], [0, -1]],
    [[1, 0], [-1, 0]],
    [[1, 1], [-1, -1]],
    [[1, -1], [-1, 1]]
  ]
  const has = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && hasPiece(player, r * COLS + c)
  const collect = ([dr, dc], r = row + dr, c = col + dc, cells = []) => has(r, c) ? collect([dr, dc], r + dr, c + dc, [...cells, [r, c]]) : cells
  const found = lines
    .map(([a, b]) => [[row, col], ...collect(a), ...collect(b)])
    .find((cells) => cells.length >= 4)
  return found?.map(([r, c]) => `${ROWS - r - 1}-${c}`) ?? []
}

const showResult = (type, title, text) => {
  els.result.hidden = false
  els.resultToken.className = `result-token ${type}`
  els.resultTitle.textContent = title
  els.resultText.textContent = text
}

const hideResult = () => {
  els.result.hidden = true
}

const launchConfetti = () => {
  const colors = ['#ef3f47', '#ffd84d', '#31c7a0', '#1266b0', '#c97934', '#fffaf2']
  els.confetti.replaceChildren(...range(56).map((i) => {
    const piece = document.createElement('span')
    piece.className = 'confetti-piece'
    piece.style.setProperty('--x', `${Math.random() * 100}%`)
    piece.style.setProperty('--color', colors[i % colors.length])
    piece.style.setProperty('--delay', `${Math.random() * 0.45}s`)
    piece.style.setProperty('--duration', `${1.5 + Math.random() * 1.4}s`)
    piece.style.setProperty('--spin', `${180 + Math.random() * 540}deg`)
    return piece
  }))
  setTimeout(() => els.confetti.replaceChildren(), 3300)
}

const render = () => {
  const isPlayable = !state.locked && !state.gameOver && state.board.currentPlayer === HUMAN
  els.board.className = `board ${isPlayable ? 'playable' : ''}`.trim()

  $$('.cell').forEach((cell) => {
    const row = Number(cell.dataset.row)
    const col = Number(cell.dataset.col)
    const player = cellPlayer(row, col)
    const isWin = state.winningCells.includes(`${row}-${col}`)
    cell.className = ['cell', player, isWin ? 'win-cell' : ''].filter(Boolean).join(' ')
    cell.setAttribute('aria-label', player ? `${player === 'human' ? 'Roter' : 'Gelber'} Stein` : 'Leeres Feld')
  })

  $$('.drop-button').forEach((button) => {
    const col = Number(button.dataset.col)
    const isFull = state.board.heightCols[col] >= ROWS
    button.disabled = state.locked || state.gameOver || state.board.currentPlayer !== HUMAN || isFull
    button.className = ['drop-button', state.hintCol === col ? 'hint' : '', isPlayable && state.hoverCol === col ? 'preview' : ''].filter(Boolean).join(' ')
  })

  els.moveCount.textContent = state.board.cntMoves
  els.humanScore.textContent = state.scores.human
  els.aiScore.textContent = state.scores.ai
  els.undoMove.disabled = state.locked || state.gameOver || state.moves.length === 0
  els.hintMove.disabled = state.locked || state.gameOver || state.board.currentPlayer !== HUMAN
  els.difficultyLabel.textContent = activeDifficulty().label
  els.engineBadge.textContent = state.engineInfo ? `Tiefe ${state.engineInfo.depth ?? '-'} · ${state.engineInfo.elapsedTime ?? '0.000'}s` : 'Engine bereit'
  els.lastAiMove.textContent = state.engineInfo?.move === undefined ? '-' : `Spalte ${state.engineInfo.move + 1}`
  els.depthStat.textContent = state.engineInfo?.depth ?? '-'
  els.nodesStat.textContent = state.engineInfo ? formatNodes(state.engineInfo.nodes) : '-'
  setTurn()
}

const finishIfNeeded = (col, player, didWin) => {
  if (didWin) {
    state.gameOver = true
    state.locked = false
    state.winningCells = winningCellsForMove(col, player)
    state.scores[player === HUMAN ? 'human' : 'ai']++
    setStatus(player === HUMAN ? 'Sieg!' : 'KI-Sieg.', player === HUMAN ? 'Vier Steine in einer Reihe.' : 'Neue Runde, neue Chance.', player === HUMAN ? 'win' : 'loss')
    showResult(player === HUMAN ? 'human' : 'ai', player === HUMAN ? 'Du gewinnst.' : 'Die KI gewinnt.', player === HUMAN ? 'Sauber ausgespielt.' : 'Die Engine hat die Reihe geschlossen.')
    if (player === HUMAN) launchConfetti()
    render()
    return true
  }

  if (state.board.cntMoves === COLS * ROWS) {
    state.gameOver = true
    state.locked = false
    setStatus('Unentschieden.', 'Das Brett ist komplett gefüllt.', 'draw')
    showResult('draw', 'Unentschieden.', 'Kein Platz mehr auf dem Brett.')
    render()
    return true
  }
  return false
}

const playMove = (col) => {
  const player = state.board.currentPlayer
  const didWin = state.board.checkWinForColumn(col)
  state.board.doMove(col)
  state.moves.push(col)
  state.hoverCol = null
  state.hintCol = null
  render()
  return finishIfNeeded(col, player, didWin)
}

const aiMove = () => {
  if (state.gameOver) return
  state.locked = true
  setStatus('Die KI denkt ...', 'Die Engine bewertet die stärksten Spalten.')
  render()

  setTimeout(() => {
    const difficulty = activeDifficulty()
    const result = findBestMove(state.board, { maxThinkingTime: difficulty.time, minDepth: 1, maxDepth: difficulty.depth })
    const fallback = range(COLS).find((col) => state.board.heightCols[col] < ROWS)
    const col = Number.isInteger(result.bestMove) ? result.bestMove : fallback
    state.locked = false
    state.engineInfo = { ...result, move: col }
    playMove(col)
    if (!state.gameOver) setStatus('Du bist dran.', `Die KI hat Spalte ${col + 1} gespielt.`)
    render()
  }, 180)
}

const humanMove = (col) => {
  if (!validColumn(col) || state.locked || state.gameOver || state.board.currentPlayer !== HUMAN || state.board.heightCols[col] >= ROWS) return
  if (!playMove(col)) {
    setStatus('Die KI ist am Zug.', 'Kurz rechnen lassen.')
    aiMove()
  }
}

const requestHint = () => {
  if (state.locked || state.gameOver || state.board.currentPlayer !== HUMAN) return
  const difficulty = activeDifficulty()
  const result = findBestMove(state.board, { maxThinkingTime: Math.min(2600, difficulty.time), minDepth: 1, maxDepth: Math.min(16, difficulty.depth) })
  state.hintCol = Number.isInteger(result.bestMove) ? result.bestMove : null
  state.engineInfo = { ...result, move: state.hintCol }
  setStatus('Tipp berechnet.', state.hintCol === null ? 'Keine freie Spalte gefunden.' : `Markiert ist Spalte ${state.hintCol + 1}.`)
  render()
}

const undoMove = () => {
  if (state.locked || state.gameOver || state.moves.length === 0) return
  const undoCount = state.board.currentPlayer === HUMAN ? Math.min(2, state.moves.length) : 1
  range(undoCount).forEach(() => state.board.undoMove(state.moves.pop()))
  state.hintCol = null
  state.winningCells = []
  setStatus('Zug zurückgenommen.', state.board.currentPlayer === HUMAN ? 'Du bist wieder dran.' : 'KI ist am Zug.')
  render()
  if (state.board.currentPlayer === AI) aiMove()
}

const newGame = () => {
  hideResult()
  state.board = new Board()
  state.board.init(els.aiStarts.checked ? AI : HUMAN)
  state.locked = false
  state.gameOver = false
  state.moves = []
  state.winningCells = []
  state.hoverCol = null
  state.hintCol = null
  state.engineInfo = null
  setStatus(els.aiStarts.checked ? 'Die KI beginnt.' : 'Du beginnst.', 'Wähle eine Spalte.')
  render()
  if (els.aiStarts.checked) aiMove()
}

const setDifficulty = (button) => {
  $$('.segment').forEach((segment) => {
    segment.classList.toggle('active', segment === button)
    segment.setAttribute('aria-checked', segment === button ? 'true' : 'false')
  })
  setStatus('KI-Stärke geändert.', `${button.dataset.label} ist aktiv.`)
  render()
}

const buildBoard = () => {
  els.board.replaceChildren(...range(ROWS).flatMap((row) =>
    range(COLS).map((col) => {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.dataset.row = row
      cell.dataset.col = col
      cell.setAttribute('role', 'img')
      return cell
    })
  ))
}

const buildControls = () => {
  els.columnPicker.replaceChildren(...range(COLS).map((col) => {
    const button = document.createElement('button')
    button.className = 'drop-button'
    button.type = 'button'
    button.dataset.col = col
    button.title = `In Spalte ${col + 1} werfen`
    button.setAttribute('aria-label', `In Spalte ${col + 1} werfen`)
    button.addEventListener('click', () => humanMove(col))
    button.addEventListener('mouseenter', () => {
      state.hoverCol = col
      state.hintCol = null
      render()
    })
    return button
  }))
}

buildBoard()
buildControls()
$$('.segment').forEach((button) => button.addEventListener('click', () => setDifficulty(button)))
els.board.addEventListener('click', (event) => humanMove(columnFromPoint(event)))
els.board.addEventListener('mousemove', (event) => {
  const col = columnFromPoint(event)
  if (state.hoverCol === col) return
  state.hoverCol = col
  state.hintCol = null
  render()
})
els.board.addEventListener('mouseleave', () => {
  state.hoverCol = null
  render()
})
els.newGame.addEventListener('click', newGame)
els.resultNewGame.addEventListener('click', newGame)
els.undoMove.addEventListener('click', undoMove)
els.hintMove.addEventListener('click', requestHint)
els.aiStarts.addEventListener('change', newGame)
document.addEventListener('keydown', (event) => {
  const col = Number(event.key) - 1
  if (col >= 0 && col < COLS) humanMove(col)
  if (event.key.toLowerCase() === 'n') newGame()
})
newGame()
