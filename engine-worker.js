import { Board, findBestMove, setBook } from './engines/cf-solver.js'
import { deserializeBook } from './engines/cf-book.js'

const moveOrder = [3, 2, 4, 1, 5, 0, 6]

// Einmal holen, danach gecacht. Faellt das Buch aus, wird ohne weitergerechnet - dann ist
// die Eroeffnung langsam, aber nichts ist kaputt.
let bookLoaded = null
const ensureBook = () => (bookLoaded ??= fetch(new URL('./data/book-8.bin', import.meta.url))
  .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((buffer) => {
    const book = deserializeBook(new Uint8Array(buffer))
    setBook(book)
    return book.count
  })
  .catch((error) => {
    self.postMessage({ type: 'book', ok: false, error: error.message })
    return 0
  }))

// Der Solver leitet den Spieler am Zug aus der Zugzahl ab, startPlayer ist dafuer egal.
const boardFromSnapshot = ({ moves }) => {
  const board = new Board()
  moves.forEach((col) => board.doMove(col))
  return board
}

const fallbackMove = (board) => moveOrder.find((col) => board.canPlay(col))

self.addEventListener('message', async ({ data }) => {
  const { id, opts, snapshot } = data

  try {
    const entries = await ensureBook()
    const board = boardFromSnapshot(snapshot)
    const result = findBestMove(board, {
      ...opts,
      onBound: (info) => self.postMessage({ id, type: 'progress', info })
    })
    self.postMessage({
      id,
      ok: true,
      result: { ...result, bestMove: Number.isInteger(result.bestMove) ? result.bestMove : fallbackMove(board), bookEntries: entries }
    })
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || 'Engine-Fehler' })
  }
})
