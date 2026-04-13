export function parseCommaSeparatedTags(raw: string): string[] {
  return raw
    .split(/[,、]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function formatSearchTagsForInput(tags: string[] | undefined): string {
  return (tags ?? []).join(', ')
}
