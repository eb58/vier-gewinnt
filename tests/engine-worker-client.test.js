import { describe, expect, test, vi } from 'vitest'
import { createEngineWorkerClient } from '../engine-worker-client.js'

class FakeWorker {
  constructor() {
    this.listeners = { error: [], message: [] }
    this.messages = []
    this.terminated = false
  }

  addEventListener = (type, listener) => this.listeners[type].push(listener)
  postMessage = (message) => this.messages.push(message)
  terminate = () => { this.terminated = true }
  emit = (type, data) => this.listeners[type].forEach((listener) => listener(type === 'message' ? { data } : data))
}

const setup = () => {
  const workers = []
  const onFailure = vi.fn()
  const client = createEngineWorkerClient({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    onFailure
  })
  return { client, onFailure, workers }
}

describe('ENGINE WORKER CLIENT', () => {
  test('terminates an obsolete search before starting its replacement', async () => {
    const { client, workers } = setup()
    const first = client.search({ maxDepth: 16 }, { moves: [] }).catch((error) => error)
    const firstWorker = workers[0]
    const second = client.search({ maxDepth: 18 }, { moves: [3] })

    expect(firstWorker.terminated).toBe(true)
    expect(await first).toMatchObject({ name: 'AbortError', message: 'Durch neuere Suche ersetzt' })
    expect(workers).toHaveLength(2)
    expect(workers[1].messages).toEqual([{ id: 2, opts: { maxDepth: 18 }, snapshot: { moves: [3] } }])

    workers[1].emit('message', { id: 2, ok: true, result: { bestMove: 3 } })
    await expect(second).resolves.toEqual({ bestMove: 3 })
  })

  test('cancels explicitly and ignores late worker messages', async () => {
    const { client, workers } = setup()
    const result = client.search({}, {}).catch((error) => error)
    const worker = workers[0]

    expect(client.cancel('Brettzustand geändert')).toBe(true)
    worker.emit('message', { id: 1, ok: true, result: { bestMove: 4 } })

    expect(worker.terminated).toBe(true)
    expect(await result).toMatchObject({ name: 'AbortError', message: 'Brettzustand geändert' })
    expect(client.cancel('Nichts aktiv')).toBe(false)
  })
})
