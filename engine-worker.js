import { Board, ROWS, findBestMove } from './engines/cf-engine.js'

const moveOrder = [3, 2, 4, 1, 5, 0, 6]

const boardFromSnapshot = ({ startPlayer, moves }) => {
  const board = new Board()
  board.init(startPlayer)
  moves.forEach((col) => board.doMove(col))
  return board
}

const fallbackMove = (board) => moveOrder.find((col) => board.heightCols[col] < ROWS)

const normalizeResult = (board, result) => ({
  ...result,
  bestMove: Number.isInteger(result.bestMove) ? result.bestMove : fallbackMove(board)
})

self.addEventListener('message', ({ data }) => {
  const { id, opts, snapshot } = data

  try {
    const board = boardFromSnapshot(snapshot)
    const result = normalizeResult(board, findBestMove(board, {
      ...opts,
      onDepth: (info) => self.postMessage({ id, type: 'progress', info })
    }))
    self.postMessage({ id, ok: true, result })
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || 'Engine-Fehler' })
  }
})
