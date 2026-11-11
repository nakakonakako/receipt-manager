export type ReceiptTotalMode = 'manual' | 'ocr'

export function getReceiptTotal(mode: ReceiptTotalMode, itemsSum: number, amount: number): number {
  return mode === 'manual' ? itemsSum + amount : amount
}

export function getReceiptAdjustment(mode: ReceiptTotalMode, itemsSum: number, amount: number): number {
  const total = getReceiptTotal(mode, itemsSum, amount)
  return mode === 'manual' ? amount : total > 0 ? total - itemsSum : 0
}

export function updateReceiptTotal(mode: ReceiptTotalMode, itemsSum: number, total: number): number {
  return mode === 'manual' ? total - itemsSum : total
}
