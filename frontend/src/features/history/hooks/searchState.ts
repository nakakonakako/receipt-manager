export type SearchState = { draft: string; submitted: string }
export type SearchAction = { type: 'edit'; value: string } | { type: 'clear' }

export function searchReducer(
  state: SearchState,
  action: SearchAction
): SearchState {
  switch (action.type) {
    case 'edit':
      return { ...state, draft: action.value, submitted: action.value.trim() }
    case 'clear':
      return { draft: '', submitted: '' }
  }
}
