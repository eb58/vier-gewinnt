import { Board, findBestMove } from './engines/cf-engine.js'

const [fen = '', depthArg = '', timeArg = '1000'] = process.argv.slice(2)
const maxDepth = Number(depthArg)
const maxThinkingTime = Number(timeArg) || 1000
const board = new Board(fen)
const result = findBestMove(board, {
  maxThinkingTime,
  ...(maxDepth > 0 ? { maxDepth } : {})
})

board.print()
console.log('Result:', result)
