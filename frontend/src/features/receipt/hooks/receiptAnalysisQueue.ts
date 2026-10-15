export type ReceiptAnalysisContext = {
  userId: string
  generation: number
}

export type ReceiptAnalysisRunTask = (
  taskId: string,
  context: ReceiptAnalysisContext
) => Promise<void>

export type ReceiptAnalysisQueue = {
  start: (
    context: ReceiptAnalysisContext,
    taskIds: readonly string[],
    runTask: ReceiptAnalysisRunTask
  ) => void
  cancel: () => void
}

type ActiveRun = {
  context: ReceiptAnalysisContext
  token: symbol
}

export const selectIdleTaskIds = (
  tasks: readonly { id: string; status: string }[]
): string[] =>
  tasks.filter((task) => task.status === 'idle').map((task) => task.id)

export const createReceiptAnalysisQueue = (
  isCurrent: (context: ReceiptAnalysisContext) => boolean
): ReceiptAnalysisQueue => {
  let activeRun: ActiveRun | null = null

  return {
    start: (context, taskIds, runTask) => {
      if (taskIds.length === 0) return
      if (activeRun && isCurrent(activeRun.context)) return

      const token = Symbol()
      const snapshotIds = [...taskIds]
      activeRun = { context, token }

      void (async () => {
        try {
          for (const taskId of snapshotIds) {
            if (activeRun?.token !== token || !isCurrent(context)) return
            try {
              await runTask(taskId, context)
            } catch {
              // One task failure must not drop the remaining snapshot.
            }
          }
        } finally {
          if (activeRun?.token === token) activeRun = null
        }
      })()
    },
    cancel: () => {
      activeRun = null
    },
  }
}
