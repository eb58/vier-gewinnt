// Buch aus einer Datei laden und im Solver aktivieren. Bewusst hier und nicht in
// cf-solver.js: das Modul soll ohne fs auskommen, damit es im Browser laeuft. Dort
// uebernimmt der Worker das Holen per fetch und ruft ebenfalls setBook auf.
import fs from 'fs'
import { deserializeBook } from '../engines/cf-book.js'
import { setBook } from '../engines/cf-solver.js'

export const loadBook = (file) => {
  const book = deserializeBook(fs.readFileSync(file))
  setBook(book)
  return book
}
