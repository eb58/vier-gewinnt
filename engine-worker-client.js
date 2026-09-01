const abortError = (reason) => Object.assign(new Error(reason), { name: 'AbortError' })

export const createEngineWorkerClient = ({ createWorker, onFailure = () => {} }) => {
  const state = { current: null, sequence: 0 }
  const jobs = new Map()

  const rejectJobs = (error) => {
    jobs.forEach(({ reject }) => reject(error))
    jobs.clear()
  }

  const handleMessage = (worker, data) => {
    if (state.current !== worker) return
    const job = jobs.get(data.id)
    if (!job) return

    if (data.type === 'progress') {
      job.onProgress(data.info)
      return
    }

    jobs.delete(data.id)
    if (data.ok) job.resolve(data.result)
    else job.reject(new Error(data.error || 'Engine-Fehler'))
  }

  const handleError = (worker, event) => {
    if (state.current !== worker) return
    const error = new Error(event.message || 'Worker-Fehler')
    state.current = null
    onFailure(error)
    rejectJobs(error)
  }

  const getWorker = () => {
    if (state.current) return state.current
    const worker = createWorker()
    worker.addEventListener('message', ({ data }) => handleMessage(worker, data))
    worker.addEventListener('error', (event) => handleError(worker, event))
    state.current = worker
    return worker
  }

  const cancel = (reason = 'Suche abgebrochen') => {
    if (jobs.size === 0) return false
    const worker = state.current
    state.current = null
    worker?.terminate()
    rejectJobs(abortError(reason))
    return true
  }

  const search = (opts, snapshot, onProgress = () => {}) => new Promise((resolve, reject) => {
    cancel('Durch neuere Suche ersetzt')
    const id = ++state.sequence
    try {
      const worker = getWorker()
      jobs.set(id, { resolve, reject, onProgress })
      worker.postMessage({ id, opts, snapshot })
    } catch (error) {
      jobs.delete(id)
      state.current?.terminate()
      state.current = null
      onFailure(error)
      reject(error)
    }
  })

  return { cancel, search }
}
