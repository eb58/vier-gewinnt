import { describe, expect, test } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Board as EngineBoard, findBestMove } from '../engines/cf-engine.js'
import { Board, solve, resetTranspositionTables } from '../engines/cf-solver.js'

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
