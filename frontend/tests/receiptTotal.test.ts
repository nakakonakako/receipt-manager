import { strict as assert } from 'node:assert'
import { getReceiptAdjustment, getReceiptTotal, updateReceiptTotal } from '../src/features/receipt/utils/receiptTotal.ts'

let adjustment = 0
const total = (prices: (number | '')[]) => getReceiptTotal('manual', prices.reduce<number>((sum, price) => sum + Number(price || 0), 0), adjustment)
assert.equal(total([]), 0)
assert.equal(total([100, 200]), 300)
assert.equal(total([150, 200]), 350)
assert.equal(total([150]), 150)
assert.equal(total([]), 0)
assert.equal(total([100, '', 200]), 300)
adjustment = updateReceiptTotal('manual', 300, 330)
assert.equal(getReceiptAdjustment('manual', 400, adjustment), 30)
assert.equal(total([100, 200, 100]), 430)
assert.equal(updateReceiptTotal('manual', 300, 300), 0)
assert.equal(getReceiptAdjustment('manual', 300, 0), 0)
assert.equal(getReceiptTotal('ocr', 300, 330), 330)
assert.equal(getReceiptTotal('ocr', 400, 330), 330)
assert.equal(getReceiptAdjustment('ocr', 400, 330), -70)
assert.equal(updateReceiptTotal('ocr', 400, 450), 450)
assert.equal(getReceiptAdjustment('ocr', 400, 0), 0)
