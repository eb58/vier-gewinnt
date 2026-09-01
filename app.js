import { Board, COLS, ROWS, findBestMove } from './engines/cf-engine.js'
import { createEngineWorkerClient } from './engine-worker-client.js'

const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const range = (n) => [...Array(n).keys()]
const DIFFICULTY_KEY = 'vier-gewinnt:difficulty'
const HUMAN = 1
const AI = 0
const state = {
  board: new Board(),
  startPlayer: HUMAN,
  locked: false,
  gameOver: false,
  scores: { human: 0, ai: 0 },
  moves: [],
  winningCells: [],
  lastAiCell: null,
  lastAiMove: null,
  hoverCol: null,
  hintCol: null,
  hintPending: false,
  engineInfo: null,
  workerFailed: false,
  aiRequest: 0,
  hintRequest: 0,
  audioContext: null,
  winPulse: null
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
  thinkingTimeStat: $('#thinkingTimeStat'),
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

const storage = {
  get: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {}
  }
}

const applySavedDifficulty = () => {
  const saved = storage.get(DIFFICULTY_KEY)
  const button = saved ? $(`.segment[data-label="${saved}"]`) : null
  if (!button) return

  $$('.segment').forEach((segment) => {
    segment.classList.toggle('active', segment === button)
    segment.setAttribute('aria-checked', segment === button ? 'true' : 'false')
  })
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
const moveOrder = [3, 2, 4, 1, 5, 0, 6]
const workerSupported = typeof Worker !== 'undefined'
const engineWorker = workerSupported ? createEngineWorkerClient({
  createWorker: () => new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' }),
  onFailure: () => { state.workerFailed = true }
}) : null
const cancelEngineSearches = (reason) => engineWorker?.cancel(reason)

const boardFromSnapshot = ({ startPlayer, moves }) => {
  const board = new Board()
  board.init(startPlayer)
  moves.forEach((col) => board.doMove(col))
  return board
}

const boardSnapshot = () => ({ startPlayer: state.startPlayer, moves: [...state.moves] })
const sameSnapshot = (snapshot) => state.startPlayer === snapshot.startPlayer && state.moves.length === snapshot.moves.length && state.moves.every((move, idx) => move === snapshot.moves[idx])
const fallbackMove = (board) => moveOrder.find((col) => board.heightCols[col] < ROWS)
const normalizeResult = (board, result) => ({ ...result, bestMove: Number.isInteger(result.bestMove) ? result.bestMove : fallbackMove(board) })
const lastAiMoveFromMoves = (startPlayer, moves) => moves.reduce((acc, col) => {
  const row = acc.heights[col]++
  const player = acc.player
  acc.player = 1 - acc.player
  if (player === AI) {
    acc.cell = `${ROWS - row - 1}-${col}`
    acc.col = col
  }
  return acc
}, { heights: Array(COLS).fill(0), player: startPlayer, cell: null, col: null })

const runEngineOnMain = (opts, snapshot, onProgress = () => {}) => {
  const board = boardFromSnapshot(snapshot)
  return normalizeResult(board, findBestMove(board, { ...opts, onDepth: onProgress }))
}

const searchEngine = async (opts, snapshot = boardSnapshot(), onProgress = () => {}) => engineWorker && !state.workerFailed
  ? { ...await engineWorker.search(opts, snapshot, onProgress), worker: true }
  : { ...runEngineOnMain(opts, snapshot, onProgress), worker: false }

const searchWithFallback = async (opts, snapshot = boardSnapshot(), onProgress = () => {}) => {
  try {
    return await searchEngine(opts, snapshot, onProgress)
  } catch (error) {
    if (state.workerFailed) return { ...runEngineOnMain(opts, snapshot, onProgress), worker: false }
    throw error
  }
}

const columnFromPoint = (event) => {
  const cell = event.target.closest('.cell')
  if (cell && els.board.contains(cell)) return Number(cell.dataset.col)

  const rect = els.board.getBoundingClientRect()
  const x = event.clientX - rect.left
  if (x < 0 || x > rect.width) return null
  return Math.min(COLS - 1, Math.max(0, Math.floor((x / rect.width) * COLS)))
}

const formatNodes = (nodes) => nodes >= 1000000 ? `${(nodes / 1000000).toFixed(1)}M` : nodes >= 1000 ? `${Math.round(nodes / 1000)}k` : `${nodes ?? '-'}`
const formatThinkingTime = (time) => time === undefined ? '-' : `${time}s`
const moveList = (moves) => moves.map((col) => col + 1).join(' ') || '-'
const playerName = (player) => player === AI ? 'KI' : 'Mensch'
const currentPlayerFromSnapshot = (snapshot) => snapshot.moves.length % 2 ? 1 - snapshot.startPlayer : snapshot.startPlayer
const scoreMeaning = (score, player, depth) => {
  const depthText = Number.isInteger(depth) ? `bis Tiefe ${depth}` : 'innerhalb der Suchtiefe'
  if (score > 0) return `Gewinnstellung fuer ${playerName(player)} ${depthText}`
  if (score < 0) return `Verluststellung fuer ${playerName(player)} ${depthText}`
  return ''
}

const logSearchStart = ({ kind, difficulty, opts, snapshot }) => {
  const board = boardFromSnapshot(snapshot)
  console.groupCollapsed?.(`[Vier Gewinnt] ${kind}: ${difficulty.label}, Tiefe ${opts.maxDepth}, Zeit ${opts.maxThinkingTime}ms`)
  console.log('Startspieler:', playerName(snapshot.startPlayer))
  console.log('Am Zug:', playerName(board.currentPlayer))
  console.log('Bewertungsperspektive:', `${playerName(board.currentPlayer)} (Spieler am Zug)`)
  console.log('Zugfolge:', moveList(snapshot.moves))
  console.log('Optionen:', opts)
  console.log(board.toString())
}

const logSearchDepth = (kind, info, perspective) => {
  console.log(`[Vier Gewinnt] ${kind} Tiefe ${info.depth}: Zug ${Number.isInteger(info.bestMove) ? info.bestMove + 1 : '-'}, Score ${info.score}, Knoten ${formatNodes(info.nodes)}, Zeit ${info.elapsedTime}s${info.timedOut ? ', Timeout' : ''}`)
}

const logSearchEnd = ({ kind, result, col, perspective }) => {
  const meaning = scoreMeaning(result.score, perspective, result.depth)
  const moveText = Number.isInteger(col) ? col + 1 : '-'
  console.log(`[Vier Gewinnt] ${kind} Ergebnis: Spalte ${Number.isInteger(col) ? col + 1 : '-'}, Score ${result.score}, Tiefe ${result.depth}, Knoten ${formatNodes(result.nodes)}, Zeit ${result.elapsedTime}s, ${result.worker ? 'Worker' : 'Main Thread'}`)
  if (meaning) console.log('Bewertung:', meaning)
  console.groupEnd?.()
  if (meaning) console.log(`[Vier Gewinnt] ${kind}: ${meaning} | bester Zug: Spalte ${moveText} | Score ${result.score}`)
}

const logSearchAbort = (kind, reason) => {
  console.log(`[Vier Gewinnt] ${kind} verworfen: ${reason}`)
  console.groupEnd?.()
}

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

const ensureAudioContext = () => {
  if (state.audioContext) return state.audioContext
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return null
  state.audioContext = new AudioContextCtor()
  return state.audioContext
}

const playWinSound = async () => {
  const audioContext = ensureAudioContext()
  if (!audioContext) return
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume()
    } catch {
      return
    }
  }

  const now = audioContext.currentTime
  const notes = [392, 494, 587]
  notes.forEach((frequency, index) => {
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const start = now + index * 0.11
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, start)
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.03, start + 0.06)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.03, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)
    osc.connect(gain)
    gain.connect(audioContext.destination)
    osc.start(start)
    osc.stop(start + 0.13)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  })
}

const playDropSound = async () => {
  const audioContext = ensureAudioContext()
  if (!audioContext) return
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume()
    } catch {
      return
    }
  }

  const now = audioContext.currentTime
  const gain = audioContext.createGain()
  const osc = audioContext.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(280, now)
  osc.frequency.exponentialRampToValueAtTime(190, now + 0.08)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)
  osc.connect(gain)
  gain.connect(audioContext.destination)
  osc.start(now)
  osc.stop(now + 0.14)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
}

const render = () => {
  const isPlayable = !state.locked && !state.gameOver && state.board.currentPlayer === HUMAN
  els.board.className = `board ${isPlayable ? 'playable' : ''}`.trim()

  $$('.cell').forEach((cell) => {
    const row = Number(cell.dataset.row)
    const col = Number(cell.dataset.col)
    const player = cellPlayer(row, col)
    const isWin = state.winningCells.includes(`${row}-${col}`)
    const isWinFlash = Boolean(state.winPulse && isWin)
    const isLastAi = state.lastAiCell === `${row}-${col}`
    cell.className = ['cell', player, isLastAi ? 'last-ai-cell' : '', isWin ? 'win-cell' : '', isWinFlash ? 'win-flash' : ''].filter(Boolean).join(' ')
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
  els.hintMove.disabled = state.hintPending || state.locked || state.gameOver || state.board.currentPlayer !== HUMAN
  els.difficultyLabel.textContent = activeDifficulty().label
  els.engineBadge.textContent = state.hintPending ? 'Tipp rechnet' : state.locked && state.board.currentPlayer === AI ? 'KI rechnet' : state.engineInfo ? `Tiefe ${state.engineInfo.depth ?? '-'} · ${state.engineInfo.elapsedTime ?? '0.000'}s` : workerSupported && !state.workerFailed ? 'Worker bereit' : 'Engine bereit'
  els.lastAiMove.textContent = state.lastAiMove === null ? '-' : `Spalte ${state.lastAiMove + 1}`
  els.depthStat.textContent = state.engineInfo?.depth ?? '-'
  els.thinkingTimeStat.textContent = formatThinkingTime(state.engineInfo?.elapsedTime)
  els.nodesStat.textContent = state.engineInfo ? formatNodes(state.engineInfo.nodes) : '-'
  setTurn()
}

const finishIfNeeded = (col, player, didWin) => {
  if (didWin) {
    state.gameOver = true
    state.locked = false
    state.winningCells = winningCellsForMove(col, player)
    state.winPulse = `${Date.now()}-${col}-${player}`
    state.scores[player === HUMAN ? 'human' : 'ai']++
    setStatus(player === HUMAN ? 'Sieg!' : 'KI-Sieg.', player === HUMAN ? 'Vier Steine in einer Reihe.' : 'Neue Runde, neue Chance.', player === HUMAN ? 'win' : 'loss')
    showResult(player === HUMAN ? 'human' : 'ai', player === HUMAN ? 'Du gewinnst.' : 'Die KI gewinnt.', player === HUMAN ? 'Sauber ausgespielt.' : 'Die Engine hat die Reihe geschlossen.')
    if (player === HUMAN) launchConfetti()
    playWinSound()
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
  const row = state.board.heightCols[col]
  const didWin = state.board.checkWinForColumn(col)
  state.board.doMove(col)
  state.moves.push(col)
  if (player === AI) {
    state.lastAiCell = `${ROWS - row - 1}-${col}`
    state.lastAiMove = col
  }
  state.hoverCol = null
  state.hintCol = null
  state.hintPending = false
  state.hintRequest++
  cancelEngineSearches('Brettzustand geändert')
  playDropSound()
  render()
  return finishIfNeeded(col, player, didWin)
}

const aiMove = async () => {
  if (state.gameOver) return
  const request = ++state.aiRequest
  const snapshot = boardSnapshot()
  const difficulty = activeDifficulty()
  const opts = { maxThinkingTime: difficulty.time, minDepth: 1, maxDepth: difficulty.depth }
  const kind = 'KI-Zug'
  const perspective = currentPlayerFromSnapshot(snapshot)

  state.locked = true
  setStatus('Die KI denkt ...', 'Die Engine bewertet die stärksten Spalten.')
  logSearchStart({ kind, difficulty, opts, snapshot })
  render()

  try {
    const result = await searchWithFallback(opts, snapshot, (info) => logSearchDepth(kind, info, perspective))
    if (request !== state.aiRequest || !sameSnapshot(snapshot) || state.gameOver) {
      logSearchAbort(kind, 'Brett hat sich seit Suchstart geändert')
      return
    }

    const fallback = fallbackMove(state.board)
    const col = Number.isInteger(result.bestMove) ? result.bestMove : fallback
    state.locked = false
    state.engineInfo = { ...result, move: col }
    logSearchEnd({ kind, result, col, perspective })
    playMove(col)
    if (!state.gameOver) setStatus('Du bist dran.', `Die KI hat Spalte ${col + 1} gespielt.`)
    render()
  } catch (error) {
    if (request !== state.aiRequest) {
      logSearchAbort(kind, 'Suchlauf ist veraltet')
      return
    }
    logSearchAbort(kind, error.message || 'Engine-Fehler')
    state.locked = false
    setStatus('Engine-Fehler.', error.message || 'Die KI konnte keinen Zug berechnen.', 'loss')
    render()
  }
}

const humanMove = (col) => {
  if (!validColumn(col) || state.locked || state.gameOver || state.board.currentPlayer !== HUMAN || state.board.heightCols[col] >= ROWS) return
  if (!playMove(col)) {
    setStatus('Die KI ist am Zug.', 'Kurz rechnen lassen.')
    aiMove()
  }
}

const requestHint = async () => {
  if (state.hintPending || state.locked || state.gameOver || state.board.currentPlayer !== HUMAN) return
  const request = ++state.hintRequest
  const snapshot = boardSnapshot()
  const difficulty = activeDifficulty()
  const opts = { maxThinkingTime: Math.min(2600, difficulty.time), minDepth: 1, maxDepth: Math.min(16, difficulty.depth) }
  const kind = 'Tipp'
  const perspective = currentPlayerFromSnapshot(snapshot)
  state.hintPending = true
  setStatus('Tipp wird berechnet ...', 'Du kannst trotzdem weiterspielen.')
  logSearchStart({ kind, difficulty, opts, snapshot })
  render()

  try {
    const result = await searchWithFallback(opts, snapshot, (info) => logSearchDepth(kind, info, perspective))
    if (request !== state.hintRequest || !sameSnapshot(snapshot) || state.gameOver || state.board.currentPlayer !== HUMAN) {
      logSearchAbort(kind, 'Brett hat sich seit Suchstart geändert')
      return
    }

    state.hintCol = Number.isInteger(result.bestMove) ? result.bestMove : null
    state.engineInfo = { ...result, move: state.hintCol }
    logSearchEnd({ kind, result, col: state.hintCol, perspective })
    setStatus('Tipp berechnet.', state.hintCol === null ? 'Keine freie Spalte gefunden.' : `Markiert ist Spalte ${state.hintCol + 1}.`)
  } catch (error) {
    if (request !== state.hintRequest) {
      logSearchAbort(kind, 'Suchlauf ist veraltet')
      return
    }
    logSearchAbort(kind, error.message || 'Engine-Fehler')
    setStatus('Tipp nicht verfügbar.', error.message || 'Die Engine konnte keinen Tipp berechnen.', 'loss')
  } finally {
    if (request === state.hintRequest) {
      state.hintPending = false
      render()
    }
  }
}

const undoMove = () => {
  if (state.locked || state.gameOver || state.moves.length === 0) return
  const undoCount = state.board.currentPlayer === HUMAN ? Math.min(2, state.moves.length) : 1
  range(undoCount).forEach(() => state.board.undoMove(state.moves.pop()))
  state.hintCol = null
  state.hintPending = false
  state.aiRequest++
  state.hintRequest++
  cancelEngineSearches('Zug zurückgenommen')
  state.winningCells = []
  const lastAiMove = lastAiMoveFromMoves(state.startPlayer, state.moves)
  state.lastAiCell = lastAiMove.cell
  state.lastAiMove = lastAiMove.col
  setStatus('Zug zurückgenommen.', state.board.currentPlayer === HUMAN ? 'Du bist wieder dran.' : 'KI ist am Zug.')
  render()
  if (state.board.currentPlayer === AI) aiMove()
}

const newGame = () => {
  hideResult()
  state.board = new Board()
  state.startPlayer = els.aiStarts.checked ? AI : HUMAN
  state.board.init(state.startPlayer)
  state.locked = false
  state.gameOver = false
  state.moves = []
  state.winningCells = []
  state.lastAiCell = null
  state.lastAiMove = null
  state.hoverCol = null
  state.hintCol = null
  state.hintPending = false
  state.engineInfo = null
  state.aiRequest++
  state.hintRequest++
  cancelEngineSearches('Neue Runde gestartet')
  state.winPulse = null
  setStatus(els.aiStarts.checked ? 'Die KI beginnt.' : 'Du beginnst.', 'Wähle eine Spalte.')
  render()
  if (els.aiStarts.checked) aiMove()
}

const setDifficulty = (button) => {
  $$('.segment').forEach((segment) => {
    segment.classList.toggle('active', segment === button)
    segment.setAttribute('aria-checked', segment === button ? 'true' : 'false')
  })
  storage.set(DIFFICULTY_KEY, button.dataset.label)
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
applySavedDifficulty()
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
document.addEventListener('pointerdown', ensureAudioContext, { once: true })
document.addEventListener('keydown', (event) => {
  const col = Number(event.key) - 1
  if (col >= 0 && col < COLS) humanMove(col)
  if (event.key.toLowerCase() === 'n') newGame()
})
newGame()
