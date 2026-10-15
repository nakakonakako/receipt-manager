import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import axios from 'axios'
import {
  classifyReceiptAnalysisError,
  RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE,
} from '../src/features/receipt/hooks/receiptAnalysisError.ts'
import {
  createReceiptAnalysisQueue,
  selectIdleTaskIds,
} from '../src/features/receipt/hooks/receiptAnalysisQueue.ts'
import { createReceiptUploaderStateCache } from '../src/features/receipt/hooks/receiptUploaderStateCache.ts'
import type { ReceiptUploaderRequestContext } from '../src/features/receipt/hooks/receiptUploaderStateCache.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const axiosError = (status: number, data: unknown = {}) => {
  const error = new axios.AxiosError('request failed')
  error.response = {
    status,
    data,
    statusText: 'error',
    headers: {},
    config: { headers: new axios.AxiosHeaders() },
  }
  return error
}

describe('receipt analysis queue', () => {
  it('snapshots idle task ids in registration order', () => {
    assert.deepEqual(
      selectIdleTaskIds([
        { id: 'done', status: 'success' },
        { id: 'first', status: 'idle' },
        { id: 'running', status: 'analyzing' },
        { id: 'failed', status: 'error' },
        { id: 'second', status: 'idle' },
      ]),
      ['first', 'second']
    )
  })

  it('runs the start snapshot one at a time and ignores a later id list until the next start', async () => {
    const context = { userId: 'user-a', generation: 1 }
    const queue = createReceiptAnalysisQueue(() => true)
    const events: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const initialIds = ['a', 'b']

    queue.start(context, initialIds, async (taskId) => {
      events.push(`start:${taskId}`)
      if (taskId === 'a') {
        await firstGate
        events.push('end:a')
      }
    })
    initialIds.push('added-after-start')
    queue.start(context, ['a', 'b', 'c'], async (taskId) => {
      events.push(`duplicate:${taskId}`)
    })

    assert.deepEqual(events, ['start:a'])
    releaseFirst()
    await flush()
    assert.deepEqual(events, ['start:a', 'end:a', 'start:b'])

    queue.start(context, ['c'], async (taskId) => {
      events.push(`start:${taskId}`)
    })
    await flush()
    assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'start:c'])
  })

  it('continues the same snapshot after one task fails', async () => {
    const context = { userId: 'user-a', generation: 1 }
    const queue = createReceiptAnalysisQueue(() => true)
    const started: string[] = []

    queue.start(context, ['a', 'b'], async (taskId) => {
      started.push(taskId)
      if (taskId === 'a') throw new Error('analysis failed')
    })
    await flush()

    assert.deepEqual(started, ['a', 'b'])
  })

  it('does not start later tasks after the captured context is no longer current', async () => {
    const context = { userId: 'user-a', generation: 1 }
    let currentGeneration = 1
    const queue = createReceiptAnalysisQueue(
      (candidate) => candidate.generation === currentGeneration
    )
    const started: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    queue.start(context, ['a', 'b'], async (taskId) => {
      started.push(taskId)
      if (taskId === 'a') await firstGate
    })
    currentGeneration = 2
    releaseFirst()
    await flush()

    assert.deepEqual(started, ['a'])
  })

  it('keeps a new generation running when an older in-flight task finishes', async () => {
    let current: ReceiptUploaderRequestContext = {
      userId: 'user-a',
      generation: 1,
    }
    const queue = createReceiptAnalysisQueue(
      (candidate) =>
        candidate.userId === current.userId &&
        candidate.generation === current.generation
    )
    const started: string[] = []
    let releaseOld: () => void = () => {}
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    const oldContext = current

    queue.start(oldContext, ['old-1', 'old-2'], async (taskId) => {
      started.push(taskId)
      if (taskId === 'old-1') await oldGate
    })
    current = { userId: 'user-b', generation: 2 }
    queue.cancel()
    queue.start(current, ['new-1'], async (taskId) => {
      started.push(taskId)
    })
    releaseOld()
    await flush()

    assert.deepEqual(started, ['old-1', 'new-1'])
  })
})

describe('receipt uploader cache analysis queue', () => {
  it('keeps the current queue across a same-user owner refresh', async () => {
    const cache = createReceiptUploaderStateCache(() => {})
    cache.setOwner('user-a')
    const context = cache.getRequestContext('user-a')
    assert.ok(context)

    const started: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    cache.startAnalysisQueue(context, ['a', 'b'], async (taskId) => {
      started.push(taskId)
      if (taskId === 'a') await firstGate
    })
    cache.setOwner('user-a')
    releaseFirst()
    await flush()

    assert.equal(cache.isCurrent(context), true)
    assert.deepEqual(started, ['a', 'b'])
  })

  it('stops unstarted tasks on logout and lets the next owner start once', async () => {
    const cache = createReceiptUploaderStateCache(() => {})
    cache.setOwner('user-a')
    const oldContext = cache.getRequestContext('user-a')
    assert.ok(oldContext)

    const started: string[] = []
    let releaseOld: () => void = () => {}
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve
    })

    cache.startAnalysisQueue(oldContext, ['old-1', 'old-2'], async (taskId) => {
      started.push(taskId)
      if (taskId === 'old-1') await oldGate
    })
    cache.startAnalysisQueue(
      oldContext,
      ['old-1', 'old-2'],
      async (taskId) => {
        started.push(`duplicate:${taskId}`)
      }
    )

    cache.setOwner('user-a')
    cache.setOwner(null)
    assert.equal(cache.isCurrent(oldContext), false)

    cache.setOwner('user-b')
    const nextContext = cache.getRequestContext('user-b')
    assert.ok(nextContext)
    cache.startAnalysisQueue(nextContext, ['new-1'], async (taskId) => {
      started.push(taskId)
    })
    releaseOld()
    await flush()

    assert.deepEqual(started, ['old-1', 'new-1'])
    assert.equal(
      cache.update(oldContext, (state) => ({
        ...state,
        tasks: [
          ...state.tasks,
          {
            id: 'stale',
            files: [],
            previewUrls: [],
            status: 'idle',
            results: [],
          },
        ],
      })),
      false
    )
  })
})

describe('receipt analysis error classification', () => {
  it('describes HTTP 429 as a concurrent analysis limit', () => {
    const failure = classifyReceiptAnalysisError(axiosError(429))
    assert.deepEqual(failure, {
      kind: 'rate_limit',
      message: RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE,
    })
    assert.match(RECEIPT_ANALYSIS_RATE_LIMIT_MESSAGE, /同時/)
  })

  it('keeps validation and auth failures distinct from other errors', () => {
    assert.deepEqual(
      classifyReceiptAnalysisError(axiosError(422, { detail: '画像が大きすぎます。' })),
      { kind: 'validation', message: '画像が大きすぎます。' }
    )
    assert.deepEqual(classifyReceiptAnalysisError(axiosError(401)), {
      kind: 'auth',
    })
    assert.deepEqual(classifyReceiptAnalysisError(axiosError(403)), {
      kind: 'auth',
    })
    assert.deepEqual(classifyReceiptAnalysisError(new Error('network')), {
      kind: 'generic',
    })
  })
})
