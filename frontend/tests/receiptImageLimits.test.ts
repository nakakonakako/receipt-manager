import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_RECEIPT_IMAGE_BYTES,
  MAX_RECEIPT_IMAGES_PER_REQUEST,
  MAX_RECEIPT_IMAGES_TOTAL_BYTES,
  RECEIPT_IMAGE_UNSUPPORTED_MESSAGE,
  classifyReceiptImageSignatureFromBytes,
  isHeifContainerFromBytes,
  validateReceiptImageSelection,
  validateReceiptImageSelectionSync,
} from '../src/features/receipt/utils/receiptImageLimits.ts'

const MINIMAL_JPEG_HEAD = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
])
const MINIMAL_PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])
const MINIMAL_WEBP_HEAD = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])
const GIF_HEAD = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
])

function makeFile(size: number, name = 'receipt.jpg', type = 'image/jpeg'): File {
  const buffer = new Uint8Array(size)
  return new File([buffer], name, { type })
}

function makeFileWithHead(
  head: Uint8Array,
  size: number,
  name = 'receipt.jpg',
  type = 'image/jpeg'
): File {
  const buffer = new Uint8Array(size)
  buffer.set(head)
  return new File([buffer], name, { type })
}

describe('receipt image preflight limits', () => {
  it('rejects empty selection and empty files', () => {
    assert.equal(validateReceiptImageSelectionSync([]).ok, false)
    assert.equal(validateReceiptImageSelectionSync([makeFile(0)]).ok, false)
  })

  it('enforces per-file limits and combine-mode count/aggregate limits', () => {
    assert.equal(
      validateReceiptImageSelectionSync(
        Array.from({ length: MAX_RECEIPT_IMAGES_PER_REQUEST }, () =>
          makeFile(1)
        ),
        { combineMode: true }
      ).ok,
      true
    )
    assert.equal(
      validateReceiptImageSelectionSync(
        Array.from({ length: MAX_RECEIPT_IMAGES_PER_REQUEST + 1 }, () =>
          makeFile(1)
        ),
        { combineMode: true }
      ).ok,
      false
    )
    assert.equal(
      validateReceiptImageSelectionSync([makeFile(MAX_RECEIPT_IMAGE_BYTES + 1)])
        .ok,
      false
    )
    const perFile = Math.floor(MAX_RECEIPT_IMAGES_TOTAL_BYTES / 2) + 1
    assert.equal(
      validateReceiptImageSelectionSync(
        [makeFile(perFile), makeFile(perFile)],
        { combineMode: true }
      ).ok,
      false
    )
    assert.equal(
      validateReceiptImageSelectionSync([makeFile(MAX_RECEIPT_IMAGE_BYTES)]).ok,
      true
    )
  })

  it('allows many independent selections when combine mode is off', () => {
    const manySmall = Array.from({ length: MAX_RECEIPT_IMAGES_PER_REQUEST + 3 }, () =>
      makeFile(1024)
    )
    assert.equal(
      validateReceiptImageSelectionSync(manySmall, { combineMode: false }).ok,
      true
    )

    const sevenMebi = 7 * 1024 * 1024
    const overAggregate = [makeFile(sevenMebi), makeFile(sevenMebi)]
    assert.equal(
      validateReceiptImageSelectionSync(overAggregate, { combineMode: false }).ok,
      true
    )
    assert.equal(
      validateReceiptImageSelectionSync(overAggregate, { combineMode: true }).ok,
      false
    )
  })

  it('rejects HEIC by claimed MIME and HEIF container signature', () => {
    const heic = makeFile(128, 'photo.heic', 'image/heic')
    assert.equal(validateReceiptImageSelectionSync([heic]).ok, false)

    const head = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])
    assert.equal(isHeifContainerFromBytes(head), true)
  })

  it('classifies JPEG, PNG, and WebP signatures', () => {
    assert.equal(classifyReceiptImageSignatureFromBytes(MINIMAL_JPEG_HEAD), 'jpeg')
    assert.equal(classifyReceiptImageSignatureFromBytes(MINIMAL_PNG_HEAD), 'png')
    assert.equal(classifyReceiptImageSignatureFromBytes(MINIMAL_WEBP_HEAD), 'webp')
    assert.equal(classifyReceiptImageSignatureFromBytes(GIF_HEAD), 'gif')
  })

  it('rejects fake JPEG and GIF bytes while accepting valid signatures', async () => {
    const fakeJpeg = makeFile(128, 'fake.jpg', 'image/jpeg')
    const fakeResult = await validateReceiptImageSelection([fakeJpeg])
    assert.equal(fakeResult.ok, false)
    if (!fakeResult.ok) {
      assert.equal(fakeResult.message, RECEIPT_IMAGE_UNSUPPORTED_MESSAGE)
    }

    const gifFile = makeFileWithHead(GIF_HEAD, 256, 'anim.gif', 'image/jpeg')
    const gifResult = await validateReceiptImageSelection([gifFile])
    assert.equal(gifResult.ok, false)

    const pngWrongType = makeFileWithHead(
      MINIMAL_PNG_HEAD,
      256,
      'wrong.jpg',
      'image/jpeg'
    )
    const pngResult = await validateReceiptImageSelection([pngWrongType])
    assert.equal(pngResult.ok, true)
  })
})
