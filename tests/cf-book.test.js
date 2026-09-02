import { describe, expect, test } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Board, canonicalKeyOf, solve, setBook, resetTranspositionTables } from '../engines/cf-solver.js'
import { deserializeBook, lookupBook } from '../engines/cf-book.js'

const bookPath = path.join(process.cwd(), 'data', 'book-8.bin')
const hasBook = fs.existsSync(bookPath)

// Ohne gebautes Buch wird uebersprungen, damit die Suite auch vor dem ersten Lauf gruen ist.
describe.skipIf(!hasBook)('EROEFFNUNGSBUCH', () => {
  const book = hasBook ? deserializeBook(fs.readFileSync(bookPath)) : null

  test('hat die erwartete Form', () => {
    expect(book.ply).toBe(8)
    expect(book.count).toBeGreaterThan(0)
    // Fuellgrad hoechstens 50 Prozent, sonst entartet die lineare Sondierung
    expect(book.count * 2).toBeLessThanOrEqual(book.mask + 1)
  })

  test('Eintraege gelten fuer die kanonische Stellung, nicht die gespiegelte', () => {
    // Eine Stellung und ihr Spiegelbild muessen denselben Eintrag treffen.
    const links = new Board('1122334')
    const rechts = new Board('7766554')
    const a = canonicalKeyOf(links)
    const b = canonicalKeyOf(rechts)
    expect(a.lo).toBe(b.lo)
    expect(a.hi).toBe(b.hi)
    expect(lookupBook(book, a.lo, a.hi)).toBe(lookupBook(book, b.lo, b.hi))
  })

  // Der eigentliche Test: das Buch darf das Ergebnis nicht veraendern, nur beschleunigen.
  // Nur Stellungen mit weniger als acht Steinen profitieren - tiefere erreichen ply 8 nie.
  test('liefert mit Buch denselben Score wie ohne', () => {
    const fen = '444444'

    setBook(null)
    resetTranspositionTables()
    const ohne = solve(new Board(fen), { maxThinkingTime: 120000 })

    setBook(book)
    resetTranspositionTables()
    const mit = solve(new Board(fen), { maxThinkingTime: 120000 })
    setBook(null)

    expect(ohne.solved).toBe(true)
    expect(mit.solved).toBe(true)
    expect(mit.score).toBe(ohne.score)
    expect(mit.nodes).toBeLessThan(ohne.nodes)
    console.log(`  ${fen}: ohne Buch ${ohne.nodes.toLocaleString('de-DE')} Knoten / ${ohne.elapsedTime}s, mit Buch ${mit.nodes.toLocaleString('de-DE')} / ${mit.elapsedTime}s`)
  }, 300000)
})
