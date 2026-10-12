import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createReceiptUploaderStateCache,
  type ReceiptUploaderStateCache,
} from '../src/features/receipt/hooks/receiptUploaderStateCache.ts'
import type { UploadTask } from '../src/features/receipt/types/index.ts'

const createTask = (id: string, previewUrl: string): UploadTask => ({
  id,
  files: [],
  previewUrls: [previewUrl],
  status: 'idle',
  results: [],
})

const addTask = (
  cache: ReceiptUploaderStateCache,
  userId: string,
  task: UploadTask
) => {
  const context = cache.getRequestContext(userId)
  assert.ok(context)
  assert.equal(
    cache.update(context, (state) => ({
      ...state,
      tasks: [...state.tasks, task],
    })),
    true
  )
  return context
}

describe('receipt uploader state cache ownership', () => {
  it('keeps a same-user token-refresh cache and clears it on logout and account switch', () => {
    const revokedUrls: string[] = []
    const cache = createReceiptUploaderStateCache((url) =>
      revokedUrls.push(url)
    )
    cache.setOwner('user-a')
    const oldContext = addTask(cache, 'user-a', createTask('task-a', 'blob:a'))
    cache.update(oldContext, (state) => ({
      ...state,
      editingState: { taskId: 'task-a', resultIndex: 0 },
      isCombineMode: true,
      cameraFiles: [new File([], 'camera.jpg')],
      cameraDraftTaskId: 'task-a',
    }))

    const beforeRefresh = cache.getSnapshot()
    cache.setOwner('user-a')
    assert.equal(cache.getSnapshot(), beforeRefresh)
    assert.equal(cache.isCurrent(oldContext), true)

    cache.setOwner(null)
    assert.deepEqual(cache.getSnapshot().tasks, [])
    assert.deepEqual(revokedUrls, ['blob:a'])
    assert.equal(cache.isCurrent(oldContext), false)

    cache.setOwner('user-b')
    assert.deepEqual(cache.getSnapshot().tasks, [])
    assert.equal(cache.getSnapshot().editingState, null)
    assert.equal(cache.getSnapshot().isCombineMode, false)
    assert.deepEqual(cache.getSnapshot().cameraFiles, [])
    assert.equal(cache.getSnapshot().cameraDraftTaskId, null)
  })

  it('invalidates an old request even if the original user signs in again', () => {
    const cache = createReceiptUploaderStateCache(() => {})
    cache.setOwner('user-a')
    const oldContext = cache.getRequestContext('user-a')
    assert.ok(oldContext)

    cache.setOwner('user-b')
    assert.equal(
      cache.update(oldContext, (state) => ({
        ...state,
        tasks: [createTask('stale-task', 'blob:stale')],
      })),
      false
    )
    cache.setOwner('user-a')

    assert.equal(cache.isCurrent(oldContext), false)
  })

  it('releases preview URLs when a task is deleted and only after the last reference is removed', () => {
    const revokedUrls: string[] = []
    const cache = createReceiptUploaderStateCache((url) =>
      revokedUrls.push(url)
    )
    cache.setOwner('user-a')
    const context = cache.getRequestContext('user-a')
    assert.ok(context)
    addTask(cache, 'user-a', createTask('task-a', 'blob:shared'))
    addTask(cache, 'user-a', createTask('task-b', 'blob:shared'))

    cache.update(context, (state) => ({
      ...state,
      tasks: state.tasks.filter((task) => task.id !== 'task-a'),
    }))
    assert.deepEqual(revokedUrls, [])

    cache.update(context, (state) => ({
      ...state,
      tasks: state.tasks.filter((task) => task.id !== 'task-b'),
    }))
    assert.deepEqual(revokedUrls, ['blob:shared'])
  })

  it('publishes auth and task changes to subscribers', () => {
    const cache = createReceiptUploaderStateCache(() => {})
    let notifications = 0
    const unsubscribe = cache.subscribe(() => notifications++)

    cache.setOwner('user-a')
    addTask(cache, 'user-a', createTask('task-a', 'blob:a'))

    assert.equal(notifications, 2)
    unsubscribe()
    cache.setOwner('user-b')
    assert.equal(notifications, 2)
  })
})
