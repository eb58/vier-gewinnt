// Baut das Eroeffnungsbuch. Einmal offline laufen lassen:
//   node tools/build-book.js [ply] [ausgabedatei] [kerne]
// Voreinstellung: 8 Steine nach data/book-8.bin auf allen Kernen.
//
// Gemessen: 77.179 kanonische Stellungen mit 8 Steinen, im Mittel rund 2,9 s pro Stellung.
// Einkernig sind das ueber 60 Stunden, auf acht Kernen rund acht - ein Lauf ueber Nacht.
//
// Der Lauf ist fortsetzbar: alle paar Minuten wird die Datei geschrieben, und beim Start
// werden bereits geloeste Stellungen uebersprungen. Ein Abbruch kostet also hoechstens die
// Zeit seit dem letzten Schreiben.
//
// Die Aufzaehlung benutzt exakt dieselbe Zugerzeugung wie die Suche (createMoveGenerator),
// damit das Buch genau die Stellungen enthaelt, die die Suche auch erreichen kann.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads'
import { Board, canonicalKeyOf, createMoveGenerator, solve, resetTranspositionTables } from '../engines/cf-solver.js'
import { createBook, putBook, lookupBook, serializeBook, deserializeBook } from '../engines/cf-book.js'

// Jeder Prozess zaehlt selbst auf (gut eine Sekunde) - so muss nichts uebertragen werden,
// und Arbeiter i nimmt einfach jede n-te Stellung.
const enumerate = (ply) => {
  const nextMoves = createMoveGenerator()
  const board = new Board()
  const seen = new Set()
  const out = []
  const trail = []
  const walk = () => {
    if (board.cntMoves === ply) {
      const k = canonicalKeyOf(board)
      const id = `${k.hi >>> 0}:${k.lo >>> 0}`
      if (!seen.has(id)) {
        seen.add(id)
        out.push(trail.flat())
      }
      return
    }
    const { n, bitsLo, bitsHi } = nextMoves(board)
    if (n < 0) return // hier ist bereits verloren, die Suche geht nicht weiter
    const list = []
    for (let i = 0; i < n; i++) list.push([bitsLo[i], bitsHi[i]])
    for (const [bLo, bHi] of list) {
      board.doMoveBit(bLo, bHi)
      trail.push([bLo, bHi])
      walk()
      trail.pop()
      board.undoMoveBit(bLo, bHi)
    }
  }
  walk()
  return out
}

const replay = (flat) => {
  const b = new Board()
  for (let i = 0; i < flat.length; i += 2) b.doMoveBit(flat[i], flat[i + 1])
  return b
}

if (!isMainThread) {
  const { ply, id, count, doneKeys } = workerData
  const positions = enumerate(ply)
  const done = new Set(doneKeys)
  resetTranspositionTables()
  let batch = []
  for (let i = id; i < positions.length; i += count) {
    const board = replay(positions[i])
    const key = canonicalKeyOf(board)
    if (done.has(`${key.hi >>> 0}:${key.lo >>> 0}`)) continue
    const r = solve(board, { maxThinkingTime: 3600000 })
    batch.push(key.lo, key.hi, r.score)
    if (batch.length >= 60) {
      parentPort.postMessage(batch)
      batch = []
    }
  }
  if (batch.length) parentPort.postMessage(batch)
  parentPort.postMessage('fertig')
} else {
  const ply = Number(process.argv[2] ?? 8)
  const outFile = process.argv[3] ?? path.join('data', `book-${ply}.bin`)
  const cores = Number(process.argv[4] ?? os.cpus().length)

  console.log(`Zaehle Stellungen mit ${ply} Steinen ...`)
  const t0 = Date.now()
  const positions = enumerate(ply)
  console.log(`  ${positions.length.toLocaleString('de-DE')} verschiedene Stellungen in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  // Vorhandenes Buch weiterverwenden, damit ein Abbruch nicht alles kostet.
  const book = createBook(ply, positions.length)
  const doneKeys = []
  if (fs.existsSync(outFile)) {
    const old = deserializeBook(fs.readFileSync(outFile))
    for (const flat of positions) {
      const key = canonicalKeyOf(replay(flat))
      const score = lookupBook(old, key.lo, key.hi)
      if (score !== undefined) {
        putBook(book, key.lo, key.hi, score)
        doneKeys.push(`${key.hi >>> 0}:${key.lo >>> 0}`)
      }
    }
    console.log(`  ${doneKeys.length.toLocaleString('de-DE')} davon schon in ${outFile}, wird fortgesetzt`)
  }

  const todo = positions.length - doneKeys.length
  if (todo === 0) {
    console.log('Buch ist bereits vollstaendig.')
    process.exit(0)
  }

  const write = () => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, serializeBook(book))
  }

  console.log(`Loese ${todo.toLocaleString('de-DE')} Stellungen auf ${cores} Kernen ...`)
  const t1 = Date.now()
  let solved = 0
  let lastWrite = Date.now()
  let running = cores

  for (let id = 0; id < cores; id++) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { ply, id, count: cores, doneKeys } })
    worker.on('message', (msg) => {
      if (msg === 'fertig') {
        if (--running === 0) {
          write()
          const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1)
          console.log(`\nFertig: ${book.count.toLocaleString('de-DE')} Eintraege in ${((Date.now() - t1) / 1000 / 3600).toFixed(2)} h`)
          console.log(`Geschrieben: ${outFile} (${mb} MB)`)
          process.exit(0)
        }
        return
      }
      for (let i = 0; i < msg.length; i += 3) putBook(book, msg[i], msg[i + 1], msg[i + 2])
      solved += msg.length / 3
      const s = (Date.now() - t1) / 1000
      const rest = (todo - solved) * s / solved
      console.log(`  ${solved.toLocaleString('de-DE')}/${todo.toLocaleString('de-DE')}  ${(s / 60).toFixed(1)} min, ${(s * 1000 / solved).toFixed(0)} ms/Stellung, geschaetzt noch ${(rest / 3600).toFixed(2)} h`)
      if (Date.now() - lastWrite > 300000) {
        write()
        lastWrite = Date.now()
        console.log(`  Zwischenstand gesichert (${book.count.toLocaleString('de-DE')} Eintraege)`)
      }
    })
    worker.on('error', (e) => console.error(`Arbeiter ${id}:`, e.message))
  }
}
