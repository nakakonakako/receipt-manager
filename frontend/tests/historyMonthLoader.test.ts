import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  createMonthLoader,
  loadMonths,
} from '../src/features/history/hooks/monthLoader.ts'

describe('history month loading', () => {
  it('shares concurrent loads and reuses successful months across views', async () => {
    const loader = createMonthLoader()
    let calls = 0
    let finish!: () => void
    const request = () => {
      calls++
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    }
    const first = loader.ensure('2026-05', request)
    const second = loader.ensure('2026-05', request)
    assert.equal(calls, 1)
    finish()
    await Promise.all([first, second])
    await loader.ensure('2026-05', request)
    assert.equal(calls, 1)
  })
  it('retries failed months and stops fetching after a view is replaced', async () => {
    const loader = createMonthLoader()
    let active = true
    const seen: string[] = []
    await assert.rejects(
      loader.ensure('2025-01', async () => {
        throw new Error('offline')
      })
    )
    await loadMonths(
      ['2025-01', '2024-12'],
      async (month) => {
        await loader.ensure(month, async () => {
          seen.push(month)
          active = false
        })
      },
      () => active
    )
    assert.deepEqual(seen, ['2025-01'])
    await loader.ensure('2024-12', async () => {
      seen.push('2024-12')
    })
    assert.deepEqual(seen, ['2025-01', '2024-12'])
  })
})

