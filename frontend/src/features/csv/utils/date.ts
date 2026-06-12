export const formatPresetLastUsedDate = (
  lastUsedAt?: string | null
): string | null => {
  if (!lastUsedAt) return null

  const date = new Date(lastUsedAt)
  if (Number.isNaN(date.getTime())) return null

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}/${month}/${day}`
}

export const formatPresetLastUsedShort = (lastUsedAt?: string | null): string =>
  formatPresetLastUsedDate(lastUsedAt) ?? '未使用'

export const formatPresetLastUsedLabel = (lastUsedAt?: string | null): string =>
  `最終使用日: ${formatPresetLastUsedShort(lastUsedAt)}`
