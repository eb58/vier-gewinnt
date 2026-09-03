// Eine Stellung von der Kommandozeile aufloesen:
//   node run.js [FEN] [bedenkzeitMs] [buchdatei]
// FEN ist die Zugfolge in 1-basierten Spalten, etwa "4433".
import fs from 'fs'
import path from 'path'
import { Board, findBestMove, setBook } from './engines/cf-solver.js'
import { deserializeBook } from './engines/cf-book.js'

const [fen = '', timeArg = '10000', bookArg = path.join('data', 'book-8.bin')] = process.argv.slice(2)

if (fs.existsSync(bookArg)) {
  const book = deserializeBook(fs.readFileSync(bookArg))
  setBook(book)
  console.log(`Buch: ${bookArg}, ply ${book.ply}, ${book.count.toLocaleString('de-DE')} Eintraege`)
} else {
  console.log(`Kein Buch unter ${bookArg} - die Eroeffnung dauert entsprechend.`)
}

const board = new Board(fen)
console.log(board.toString())
console.log(findBestMove(board, { maxThinkingTime: Number(timeArg) || 10000 }))
