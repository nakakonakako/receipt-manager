import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { logoutLocalSession } from '../src/contexts/logoutLocalSession.ts'

describe('logout local session', () => {
  it('clears the owner before a local sign-out and does not use another scope', async () => {
    const events: string[] = []

    await logoutLocalSession({
      setOwner: (userId) => {
        events.push(`setOwner:${String(userId)}`)
      },
      signOut: async (options) => {
        events.push(`signOut:${options.scope}`)
      },
    })

    assert.deepEqual(events, ['setOwner:null', 'signOut:local'])
  })
})
