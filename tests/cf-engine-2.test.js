import { describe, expect, test } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Board as EngineBoard, findBestMove } from '../engines/cf-engine.js'
import { Board, solve, findBestMove as solverFindBestMove, resetTranspositionTables } from '../engines/cf-solver.js'

const readData = (fileName, limit) => fs.readFileSync(path.join(process.cwd(), 'data', fileName), 'utf-8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => {
    const [input, expected] = line.split(' ')
    return { input, expected: Number(expected) }
  })
  .slice(0, limit)

// Wie bei Pons: die Datendateien enthalten den exakten Score, nicht nur das Vorzeichen.
// Ein Sieg mit dem naechsten Stein bei `stones` Steinen ist (43 - stones) / 2 wert, ein
// frueherer Sieg also mehr. Der Solver wird darauf punktgenau geprueft, und je Satz werden
// Zeit und Knoten wie in Pons' Benchmark-Tabelle ausgewiesen.
const solverSet = (fileName, limit) => {
  const rows = readData(fileName, limit)
  test(`${fileName}: ${rows.length} Stellungen, exakter Score`, () => {
    resetTranspositionTables()
    const start = performance.now()
    const wrong = []
    let nodes = 0

    rows.forEach(({ input, expected }) => {
      const result = solve(new Board(input), { maxThinkingTime: 20000 })
      nodes += result.nodes
      if (!result.solved) wrong.push(`${input}: ungeloest`)
      else if (result.score !== expected) wrong.push(`${input}: erwartet ${expected}, bekommen ${result.score}`)
    })

    const seconds = (performance.now() - start) / 1000
    console.log(`  ${fileName}: ${(seconds * 1000 / rows.length).toFixed(2)} ms/Stellung, ${Math.round(nodes / rows.length).toLocaleString('de-DE')} Knoten/Stellung, ${(nodes / seconds / 1000).toFixed(0)}k Knoten/s`)
    expect(wrong).toEqual([])
  }, 120000) // eigenes Limit: die Eroeffnungssaetze sind noch teuer
}

describe('SOLVER: Sofortgewinn an der Wurzel', () => {
  // negamax setzt voraus, dass der Ziehende nicht sofort gewinnen kann. Pons' Testsaetze
  // erfuellen das von aussen, deshalb deckt keiner von ihnen diesen Fall ab.
  test('erkennt einen Gewinnzug in der Wurzelstellung', () => {
    resetTranspositionTables()
    expect(solve(new Board('112233'), { maxThinkingTime: 5000 }).score).toBe(18) // (43 - 6) / 2
    expect(solve(new Board('4444443333335555'), { maxThinkingTime: 5000 }).solved).toBe(true)
  })
})

describe('SOLVER: exakte Scores', () => {
  solverSet('Test_L3_R1', 1000) // Endspiel
  solverSet('Test_L2_R1', 1000) // Mittelspiel
  solverSet('Test_L1_R1', 300) // Eroeffnung, deutlich teurer
})

// Die alte Engine kennt nur gewonnen/offen/verloren und bleibt vorerst die Engine der App.
// Fuer sie ist das Vorzeichen alles, was sich pruefen laesst.
const engineSet = (fileName, limit) => {
  const rows = readData(fileName, limit)
  test(`${fileName}: ${rows.length} Stellungen, Vorzeichen`, () => {
    const wrong = rows.filter(({ input, expected }) =>
      Math.sign(findBestMove(new EngineBoard(input), { maxThinkingTime: 5000 }).score) !== Math.sign(expected))
    expect(wrong.map(({ input }) => input)).toEqual([])
  })
}

describe('ENGINE: Vorzeichen', () => {
  engineSet('Test_L3_R1', 1000)
  engineSet('Test_L2_R1', 1000)
  engineSet('Test_L1_R1', 1000)
})

// Ein Solver kann nicht schlechter spielen, nur weniger wissen - und mit Buch weiss er in
// der Eroeffnung alles. Die Schwierigkeitsstufen brauchen deshalb einen bewussten Fehler.
describe('SOLVER: Schwierigkeit ueber blunderRate', () => {
  const opts = { maxThinkingTime: 5000 }
  // Eine Stellung mit echter Auswahl - bei nur einem nicht verlierenden Zug gibt es
  // nichts zu verschlechtern, und der Test wuerde am falschen Objekt scheitern.
  const mittelspiel = readData('Test_L2_R1', 40)
    .map(({ input }) => input)
    .find((fen) => {
      resetTranspositionTables()
      return solverFindBestMove(new Board(fen), opts).candidates > 1
    })

  test('ohne blunderRate wird der beste Zug gespielt', () => {
    resetTranspositionTables()
    const r = solverFindBestMove(new Board(mittelspiel), opts)
    expect(r.blundered).toBe(false)
    expect(r.bestMove).toBe(r.bestKnownMove)
  })

  test('mit blunderRate 1 wird ein anderer, aber nicht sofort verlierender Zug gespielt', () => {
    resetTranspositionTables()
    const r = solverFindBestMove(new Board(mittelspiel), { ...opts, blunderRate: 1, random: () => 0 })
    expect(r.blundered).toBe(true)
    expect(r.bestMove).not.toBe(r.bestKnownMove)
    // Der Score gilt weiter fuer den besten Zug, die Bewertung bleibt also ehrlich.
    expect(r.score).toBeDefined()
  })

  test('ein sofortiger Gewinn wird auch auf der schwaechsten Stufe genommen', () => {
    resetTranspositionTables()
    const r = solverFindBestMove(new Board('112233'), { ...opts, blunderRate: 1, random: () => 0 })
    expect(r.bestMove).toBe(3) // Spalte 4
    expect(r.blundered).toBeFalsy()
  })
})
