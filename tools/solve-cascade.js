// Loest die Eroeffnung von unten nach oben, mit dem ply-8-Buch im Ruecken:
//   node tools/solve-cascade.js [buchdatei]
// Jede Ebene ist billiger als ohne Buch, weil die Suche bei acht Steinen endet.
// Am Ende steht der Wert des leeren Bretts.
import path from 'path'
import { Board, solve, resetTranspositionTables } from '../engines/cf-solver.js'
import { loadBook } from './load-book.js'

const bookFile = process.argv[2] ?? path.join('data', 'book-8.bin')
const book = loadBook(bookFile)
console.log(`Buch geladen: ply ${book.ply}, ${book.count.toLocaleString('de-DE')} Eintraege\n`)

// Von sieben Steinen abwaerts bis zum leeren Brett. Die Spalten sind 1-basiert wie im FEN.
// Nicht siebenmal Spalte 4 - eine Spalte fasst nur sechs Steine.
const stellungen = ['4444443', '444444', '44444', '4444', '444', '44', '4', '']

for (const fen of stellungen) {
  resetTranspositionTables()
  const r = solve(new Board(fen), { maxThinkingTime: 3600000, ttBits: 23 })
  const name = fen === '' ? '(leeres Brett)' : `"${fen}"`
  console.log(`${name.padEnd(16)} ${fen.length} Steine: ${r.solved ? `Score ${r.score}` : `offen [${r.min}, ${r.max}]`}, ${r.nodes.toLocaleString('de-DE')} Knoten, ${r.elapsedTime}s`)
}
