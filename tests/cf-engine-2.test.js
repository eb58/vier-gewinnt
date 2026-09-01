import { describe, expect, test } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Board, findBestMove } from '../engines/cf-engine.js'

const readData = (fileName) => {
  const content = fs.readFileSync(path.join(process.cwd(), 'data', fileName), 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [input, expected] = line.split(' ')
      return {
        input,
        expected: Number(expected)
      }
    })
}

const testData = (fileName) => {
  readData(fileName)
    .slice(0, 1000)
    .forEach(({ input, expected }, index) =>
      test(`Test ${index + 1}: ${input} ->  ${expected}`, () => {
        const board = new Board(input)
        const si = findBestMove(board, { maxThinkingTime: 5000 })
        expect(Math.sign(si.score)).toBe(Math.sign(expected))
      })
    )
}

describe('Test_L1_R1 ', () => testData('Test_L1_R1')) // ~4.5 sec
// describe('Test_L1_R2 ', () => testData('Test_L1_R2'))
// describe('Test_L1_R3 ', () => testData('Test_L1_R3'))

describe('Test_L2_R1 ', () => testData('Test_L2_R1')) // ~ 1 sec ok
// describe('Test_L2_R2 ', () => testData('Test_L2_R2')) // ~ 3 min 15 sec

describe('Test_L3_R1 ', () => testData('Test_L3_R1')) // ~0.4 sec
