import { strict as assert } from 'node:assert'
import { it } from 'node:test'
import { searchReducer } from '../src/features/history/hooks/searchState.ts'

it('keeps draft edits separate until submit and restores month mode on clear', () => {
  const initial = { draft: '', submitted: '' }
  const draft = searchReducer(initial, { type: 'edit', value: ' 過去 ' })
  assert.equal(draft.submitted, '')
  const searching = searchReducer(draft, { type: 'submit' })
  assert.equal(searching.submitted, '過去')
  const nextDraft = searchReducer(searching, { type: 'edit', value: '別の語' })
  assert.equal(nextDraft.submitted, '過去')
  assert.deepEqual(searchReducer(nextDraft, { type: 'clear' }), initial)
})
