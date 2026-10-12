import type { UploadTask } from '../types/index.ts'

export type ReceiptUploaderEditingState = {
  taskId: string
  resultIndex: number
} | null

export type ReceiptUploaderState = {
  tasks: UploadTask[]
  editingState: ReceiptUploaderEditingState
  isCombineMode: boolean
  cameraFiles: File[]
  cameraDraftTaskId: string | null
}

export type ReceiptUploaderSnapshot = ReceiptUploaderState & {
  ownerUserId: string | null
  generation: number
}

export type ReceiptUploaderRequestContext = {
  userId: string
  generation: number
}

type Listener = () => void

export interface ReceiptUploaderStateCache {
  getSnapshot: () => ReceiptUploaderSnapshot
  subscribe: (listener: Listener) => () => void
  setOwner: (userId: string | null) => void
  getRequestContext: (userId: string) => ReceiptUploaderRequestContext | null
  isCurrent: (context: ReceiptUploaderRequestContext) => boolean
  update: (
    context: ReceiptUploaderRequestContext,
    updater: (state: ReceiptUploaderState) => ReceiptUploaderState
  ) => boolean
}

const emptyState = (): ReceiptUploaderState => ({
  tasks: [],
  editingState: null,
  isCombineMode: false,
  cameraFiles: [],
  cameraDraftTaskId: null,
})

const getPreviewUrls = (tasks: UploadTask[]): Set<string> =>
  new Set(tasks.flatMap((task) => task.previewUrls))

const releaseRemovedPreviewUrls = (
  previousTasks: UploadTask[],
  nextTasks: UploadTask[],
  revokeObjectURL: (url: string) => void
) => {
  const nextUrls = getPreviewUrls(nextTasks)
  for (const url of getPreviewUrls(previousTasks)) {
    if (!nextUrls.has(url)) {
      revokeObjectURL(url)
    }
  }
}

export const revokeReceiptUploaderPreviewUrls = (urls: string[]) => {
  for (const url of new Set(urls)) {
    URL.revokeObjectURL(url)
  }
}

export const createReceiptUploaderStateCache = (
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url)
): ReceiptUploaderStateCache => {
  let snapshot: ReceiptUploaderSnapshot = {
    ...emptyState(),
    ownerUserId: null,
    generation: 0,
  }
  const listeners = new Set<Listener>()

  const publish = (nextSnapshot: ReceiptUploaderSnapshot) => {
    snapshot = nextSnapshot
    listeners.forEach((listener) => listener())
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setOwner: (userId) => {
      if (snapshot.ownerUserId === userId) return

      releaseRemovedPreviewUrls(snapshot.tasks, [], revokeObjectURL)
      publish({
        ...emptyState(),
        ownerUserId: userId,
        generation: snapshot.generation + 1,
      })
    },
    getRequestContext: (userId) =>
      snapshot.ownerUserId === userId
        ? { userId, generation: snapshot.generation }
        : null,
    isCurrent: (context) =>
      snapshot.ownerUserId === context.userId &&
      snapshot.generation === context.generation,
    update: (context, updater) => {
      if (
        snapshot.ownerUserId !== context.userId ||
        snapshot.generation !== context.generation
      ) {
        return false
      }

      const previousSnapshot = snapshot
      const nextState = updater(previousSnapshot)
      releaseRemovedPreviewUrls(
        previousSnapshot.tasks,
        nextState.tasks,
        revokeObjectURL
      )
      publish({
        ...nextState,
        ownerUserId: previousSnapshot.ownerUserId,
        generation: previousSnapshot.generation,
      })
      return true
    },
  }
}

type ReceiptUploaderGlobal = typeof globalThis & {
  __receiptUploaderStateCache?: ReceiptUploaderStateCache
}

const revokeLegacyPreviewUrls = (legacyCache: unknown) => {
  if (!legacyCache || typeof legacyCache !== 'object') return
  const tasks = (legacyCache as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return

  const urls = new Set<string>()
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue
    const previewUrls = (task as { previewUrls?: unknown }).previewUrls
    if (!Array.isArray(previewUrls)) continue
    for (const url of previewUrls) {
      if (typeof url === 'string') urls.add(url)
    }
  }

  urls.forEach((url) => URL.revokeObjectURL(url))
}

const isReceiptUploaderStateCache = (
  value: unknown
): value is ReceiptUploaderStateCache => {
  if (!value || typeof value !== 'object') return false
  const cache = value as Partial<ReceiptUploaderStateCache>
  return (
    typeof cache.getSnapshot === 'function' &&
    typeof cache.subscribe === 'function' &&
    typeof cache.setOwner === 'function' &&
    typeof cache.getRequestContext === 'function' &&
    typeof cache.isCurrent === 'function' &&
    typeof cache.update === 'function'
  )
}

const getGlobalReceiptUploaderStateCache = (): ReceiptUploaderStateCache => {
  const globalState = globalThis as ReceiptUploaderGlobal
  const existingCache = globalState.__receiptUploaderStateCache as unknown
  if (isReceiptUploaderStateCache(existingCache)) return existingCache

  // Discard caches created by older module versions: they have no user owner.
  revokeLegacyPreviewUrls(existingCache)
  const cache = createReceiptUploaderStateCache()
  globalState.__receiptUploaderStateCache = cache
  return cache
}

export const receiptUploaderStateCache = getGlobalReceiptUploaderStateCache()
