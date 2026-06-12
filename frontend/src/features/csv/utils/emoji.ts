export const DEFAULT_PRESET_ICON = '🧾'

export const PRESET_ICON_SUGGESTIONS = [
  '🧾',
  '💳',
  '💰',
  '💴',
  '🏦',
  '🏪',
  '🛒',
  '📊',
  '🍎',
  '🍽️',
  '☕',
  '⛽',
  '🚃',
  '✈️',
  '🏠',
  '👕',
  '💊',
  '📱',
  '🎮',
  '🎁',
  '🐶',
  '⭐',
  '🔖',
  '☁️',
]

/**
 * 入力が「絵文字1つ」として妥当かを判定する。
 * 文字（英数字・かな・漢字など）や数字を含む場合は不可。
 */
export const isValidPresetIcon = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false
  // 文字・数字は不可
  if (/[\p{L}\p{N}]/u.test(trimmed)) return false
  // 絵文字（ピクトグラム）を含むこと
  return /\p{Extended_Pictographic}/u.test(trimmed)
}

/**
 * 保存済みのアイコン値を表示用に解決する。無効・未設定なら既定アイコン。
 */
export const resolvePresetIcon = (icon?: string | null): string =>
  icon && isValidPresetIcon(icon) ? icon : DEFAULT_PRESET_ICON
