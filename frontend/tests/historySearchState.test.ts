import { strict as assert } from 'node:assert'
import { it } from 'node:test'
import { searchReducer } from '../src/features/history/hooks/searchState.ts'

it('updates the search on each edit and restores month mode when cleared', () => {
  const initial = { draft: '', submitted: '' }
  const first = searchReducer(initial, { type: 'edit', value: ' 過去 ' })
  assert.equal(first.submitted, '過去')
  const next = searchReducer(first, { type: 'edit', value: '別の語' })
  assert.equal(next.submitted, '別の語')
  assert.deepEqual(searchReducer(next, { type: 'clear' }), initial)
  assert.equal(searchReducer(next, { type: 'edit', value: '' }).submitted, '')
})
