export type SearchState = { draft: string; submitted: string }
export type SearchAction =
  { type: 'edit'; value: string } | { type: 'submit' } | { type: 'clear' }

export function searchReducer(
  state: SearchState,
  action: SearchAction
): SearchState {
  switch (action.type) {
    case 'edit':
      return { ...state, draft: action.value }
    case 'submit':
      return { ...state, submitted: state.draft.trim() }
    case 'clear':
      return { draft: '', submitted: '' }
  }
}
