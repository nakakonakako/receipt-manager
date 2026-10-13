const MEBIBYTE = 1024 * 1024

export const MAX_RECEIPT_IMAGES_PER_REQUEST = 10
export const MAX_RECEIPT_IMAGE_BYTES = 10 * MEBIBYTE
export const MAX_RECEIPT_IMAGES_TOTAL_BYTES = 12 * MEBIBYTE

export const RECEIPT_IMAGE_COUNT_LIMIT_MESSAGE =
  'レシート画像は1回の送信で10枚までです。枚数を減らして再度お試しください。'
export const RECEIPT_IMAGE_FILE_SIZE_LIMIT_MESSAGE =
  '画像が大きすぎます。1枚あたり10MiB以下のファイルを選んでください。'
export const RECEIPT_IMAGE_TOTAL_SIZE_LIMIT_MESSAGE =
  '選択した画像の合計サイズが上限を超えています。枚数を減らすか、合計12MiB以下の画像を選んでください。'
export const RECEIPT_IMAGE_EMPTY_MESSAGE =
  '空の画像ファイルは選べません。別の画像を選んでください。'
export const RECEIPT_IMAGE_HEIF_MESSAGE =
  'HEIC/HEIF形式の画像は現在サポートされていません。JPEG、PNG、またはWebPに変換してから再度お試しください。'
export const RECEIPT_IMAGE_UNSUPPORTED_MESSAGE =
  'この画像形式はサポートされていません。JPEG、PNG、またはWebP形式の画像を選んでください。'

export type ReceiptImagePreflightFailure = {
  ok: false
  message: string
  remedy: string
}

export type ReceiptImagePreflightSuccess = { ok: true }

export type ReceiptImagePreflightResult =
  | ReceiptImagePreflightSuccess
  | ReceiptImagePreflightFailure

export type ReceiptImageSelectionOptions = {
  /** When true, enforce count and aggregate limits for one combined /analyze request. */
  combineMode?: boolean
}

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'avis',
  'ncdi',
])

export type ReceiptImageSignature =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'unknown'

export function classifyReceiptImageSignatureFromBytes(
  head: Uint8Array
): ReceiptImageSignature {
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return 'jpeg'
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'png'
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return 'webp'
  }
  if (
    head.length >= 6 &&
    head[0] === 0x47 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x38 &&
    (head[4] === 0x37 || head[4] === 0x39) &&
    head[5] === 0x61
  ) {
    return 'gif'
  }
  return 'unknown'
}

export function isHeifContainerFromBytes(head: Uint8Array): boolean {
  if (head.length < 12) return false
  if (head[4] !== 0x66 || head[5] !== 0x74 || head[6] !== 0x79 || head[7] !== 0x70) {
    return false
  }
  const limit = Math.min(head.length, 64)
  for (let offset = 8; offset + 4 <= limit; offset += 4) {
    const brand = String.fromCharCode(
      head[offset],
      head[offset + 1],
      head[offset + 2],
      head[offset + 3]
    )
    if (HEIF_BRANDS.has(brand)) return true
  }
  return false
}

export async function readFileHead(file: File, length = 64): Promise<Uint8Array> {
  const slice = file.slice(0, length)
  return new Uint8Array(await slice.arrayBuffer())
}

function validateSingleReceiptFile(file: File): ReceiptImagePreflightResult {
  if (file.size === 0) {
    return {
      ok: false,
      message: RECEIPT_IMAGE_EMPTY_MESSAGE,
      remedy: '別の画像ファイルを選んでください。',
    }
  }
  if (file.size > MAX_RECEIPT_IMAGE_BYTES) {
    return {
      ok: false,
      message: RECEIPT_IMAGE_FILE_SIZE_LIMIT_MESSAGE,
      remedy:
        '写真アプリの設定でJPEG形式にするか、画像編集アプリでJPEG/PNG/WebPに変換してください。',
    }
  }
  const claimedType = file.type.toLowerCase()
  if (claimedType === 'image/heic' || claimedType === 'image/heif') {
    return {
      ok: false,
      message: RECEIPT_IMAGE_HEIF_MESSAGE,
      remedy:
        'iPhoneの「設定 → カメラ → フォーマット」で「互換性優先」にするか、写真アプリでJPEGに変換してください。',
    }
  }
  return { ok: true }
}

export function validateReceiptImageSelectionSync(
  files: File[],
  options: ReceiptImageSelectionOptions = {}
): ReceiptImagePreflightResult {
  const combineMode = options.combineMode ?? false

  if (files.length === 0) {
    return {
      ok: false,
      message: RECEIPT_IMAGE_EMPTY_MESSAGE,
      remedy: 'JPEG、PNG、またはWebP形式の画像を選んでください。',
    }
  }

  if (combineMode) {
    if (files.length > MAX_RECEIPT_IMAGES_PER_REQUEST) {
      return {
        ok: false,
        message: RECEIPT_IMAGE_COUNT_LIMIT_MESSAGE,
        remedy: '10枚以下に分けて送信してください。',
      }
    }

    let totalBytes = 0
    for (const file of files) {
      const perFile = validateSingleReceiptFile(file)
      if (!perFile.ok) return perFile
      totalBytes += file.size
      if (totalBytes > MAX_RECEIPT_IMAGES_TOTAL_BYTES) {
        return {
          ok: false,
          message: RECEIPT_IMAGE_TOTAL_SIZE_LIMIT_MESSAGE,
          remedy: '枚数を減らすか、より小さい画像を選んでください。',
        }
      }
    }
    return { ok: true }
  }

  for (const file of files) {
    const perFile = validateSingleReceiptFile(file)
    if (!perFile.ok) return perFile
  }
  return { ok: true }
}

export async function validateReceiptImageSelection(
  files: File[],
  options: ReceiptImageSelectionOptions = {}
): Promise<ReceiptImagePreflightResult> {
  const syncResult = validateReceiptImageSelectionSync(files, options)
  if (!syncResult.ok) return syncResult

  const unsupportedRemedy =
    'JPEG、PNG、またはWebP形式の画像を選ぶか、写真アプリで変換してください。'

  for (const file of files) {
    const head = await readFileHead(file)
    if (isHeifContainerFromBytes(head)) {
      return {
        ok: false,
        message: RECEIPT_IMAGE_HEIF_MESSAGE,
        remedy:
          'JPEG、PNG、またはWebPに変換してから再度お試しください（自動圧縮・リサイズは行いません）。',
      }
    }
    const signature = classifyReceiptImageSignatureFromBytes(head)
    if (signature === 'gif' || signature === 'unknown') {
      return {
        ok: false,
        message: RECEIPT_IMAGE_UNSUPPORTED_MESSAGE,
        remedy: unsupportedRemedy,
      }
    }
  }

  return { ok: true }
}

export function formatReceiptImagePreflightToast(
  failure: ReceiptImagePreflightFailure
): string {
  return `${failure.message} ${failure.remedy}`
}
