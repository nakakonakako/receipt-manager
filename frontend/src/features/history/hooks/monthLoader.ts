/** Shares in-flight month requests and remembers successful loads. Failed loads can be retried. */
export function createMonthLoader() {
  const loaded = new Set<string>()
  const pending = new Map<string, Promise<void>>()
  return {
    markLoaded(month: string) {
      loaded.add(month)
    },
    async ensure(month: string, load: (month: string) => Promise<void>) {
      if (!month || loaded.has(month)) return
      let request = pending.get(month)
      if (!request) {
        request = load(month)
          .then(() => {
            loaded.add(month)
          })
          .finally(() => {
            pending.delete(month)
          })
        pending.set(month, request)
      }
      await request
    },
  }
}

export async function loadMonths(
  months: string[],
  ensure: (month: string) => Promise<void>,
  isActive: () => boolean
) {
  for (const month of months) {
    if (!isActive()) return
    await ensure(month)
  }
}
