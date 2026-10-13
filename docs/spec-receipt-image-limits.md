# レシート画像入力の上限と検証（S1-06）

## 目的

`/analyze` に送るレシート画像の枚数・サイズ・形式を、バックエンドで権威的に検証する。すべての検証が終わってからだけ Gemini を呼ぶ。フロントは選択時に同じ上限を案内し、無効なファイルを早めに止める。

## サポート形式

| 形式 | MIME（実データから導出） |
|------|-------------------------|
| JPEG | `image/jpeg` |
| PNG | `image/png` |
| WebP | `image/webp` |

- 拡張子やクライアント申告の `Content-Type` は信頼しない。Pillow でヘッダを読み、`verify()` で破損を検出する。
- ピクセルデータのデコード・リサイズ・自動圧縮は行わない。
- 画素数上限: **16,777,216**（幅×高さ）。巨大 IHDR 等のピクセル爆弾はここで拒否する。

## 明示的に非対応（HEIC / HEIF）

Gemini API が HEIC/HEIF を受け付ける場合でも、本アプリではデコーダー・実機プレビュー・検証経路が未整備のため **対応済みにしない**。

- ISO BMFF の `ftyp` ブランド（`heic`, `mif1` 等）を先に検出して拒否する。
- フロントも `image/heic` / `image/heif` と先頭バイトの HEIF コンテナを拒否し、JPEG/PNG/WebP への変換を日本語で案内する。

## サイズ・枚数

| 項目 | 値 |
|------|-----|
| 1リクエスト最大枚数 | 10 |
| 1枚あたり最大 | 10 MiB（10 × 1024 × 1024 = **10,485,760** bytes） |
| 合計最大（生バイト） | 12 MiB（12 × 1024 × 1024 = **12,582,912** bytes） |

読み取りは `UploadFile.read` を **remaining + 1**（1枚上限・合計上限の両方）までに制限し、超過分を無制限に読みしない。

## Gemini inline 20 MB との関係

- 生 12,582,912 bytes を **1 つの blob** として Base64 すると **16,777,216** 文字。最大 10 枚に分割して独立にエンコードした場合のパディング込み上限は **16,777,240** 文字（`worst_case_split_base64_char_count`）。
- 既存のプロンプト・`response_schema`・JSON ラッパのオーバーヘッドを残すため、**生データ合計 12 MiB** を上限とする（Base64 だけで SDK の inline 約 20 MB 枠の大半を使う）。
- `GeminiService.analyze_receipt` 境界でも同じ生バイト・Base64 文字数・許可 MIME を再チェックする。SDK が「20MB」をリクエスト全体かパート単位かの保証が曖昧なため、画像生データは 12 MiB に抑え、超過は呼び出し前に拒否する。

nginx の `client_max_body_size 20M` は変更しない（multipart 本体は 12 MiB 生データ + フォームオーバーヘッドでも 20M 内に収まる想定）。

## 拒否時の応答

- HTTP **422**、`detail` は固定の日本語のみ（ファイル名・画像内容・認証情報は含めない）。
- エラーログにファイル名・画像内容・トークンを出さない。

## 残リスク

- **並行リクエスト**: ユーザーが同時に複数の `/analyze` を送った場合、各リクエストは独立に上限内でも、サーバー側のメモリ・Gemini クォータは加算される。本 PR ではリクエスト単位の上限のみ。
- **フロント preflight**: サイズ・枚数・HEIF 先頭は同期/軽量読み取りで検証するが、形式の完全検証はバックエンドが権威。

## 実装参照

- `backend/app/services/receipt_image_service.py`
- `backend/app/schemas/receipt_image.py`
- `backend/app/services/gemini_service.py`（`analyze_receipt` の MIME 引き渡し）
- `frontend/src/features/receipt/utils/receiptImageLimits.ts`
