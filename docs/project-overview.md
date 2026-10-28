# AI家計簿（receipt-manager）— プロジェクト概要

> **このリポジトリは機能 A（レシート管理）である。**
> 厳密な単価比較（機能 B）は本リポジトリの責務外。分離方針は [spec-split-receipt-and-unit-price.md](./spec-split-receipt-and-unit-price.md) を参照。

| 項目 | 内容 |
|------|------|
| リポジトリ名 | `receipt-manager` |
| プロダクト名（UI） | AI家計簿 / Receipt Manager |
| ドキュメント最終更新 | 2026-10-28 |
| 文書の扱い | **生きた概要**。機能の追加・削除・方針変更のたびに本ファイルを更新する |

---

## この文書の更新ルール

機能や環境が変わったら、最低限次を直す。

1. **§4 機能一覧** … 追加 / 削除 / ステータス変更
2. **§5 データモデル** … テーブル・主要カラムの増減
3. **§6 技術スタック / §7 環境** … 依存や起動手順の変化
4. **§10 変更履歴** … 日付と一行要約を追記

詳細な設計判断は別 md（`docs/spec-*.md` など）に切り出し、ここからはリンクする。

---

## 1. 目的

**どこで・何を・いくら使ったかを、手間少なく記録し、あとから汎用的に検索・管理・可視化する。**

- 主用途はレシート（およびカード等 CSV）の家計記録
- AI（Gemini）で OCR・カテゴリ推定・家計 Q&A を補助する
- 「100g 単価で厳密に店比較する」ことは **目的に含めない**（→ 機能 B）

---

## 2. スコープ（A / B）

| | 本プロジェクト（A） | 機能 B（別系統） |
|--|---------------------|------------------|
| 目的 | 支出の記録・検索・管理 | 意図した商品だけの厳密単価比較 |
| カテゴリ | AI / 学習の `main` / `sub` | 手動フォルダのみ |
| 単価・重量 | 扱わない（本流にしない） | g / 個 / ml 等の確定データのみ |
| 値段推移・店頭照会 | **置かない**（削除済み） | B 側で実装 |
| 連携 | B を知らない | A のレシート DB を一方向参照 |

詳細: [spec-split-receipt-and-unit-price.md](./spec-split-receipt-and-unit-price.md)

---

## 3. アーキテクチャ概要

```
Browser (React / Vite SPA)
  │  Supabase Auth（Google OAuth）
  │  一部は Supabase JS 直アクセス（RLS）
  │  /api → Vite proxy（開発） / nginx（本番）
  ▼
FastAPI (uvicorn :8000)
  │  x-supabase-token → ユーザー単位の Supabase クライアント
  │  GEMINI_API_KEY → Google Gemini
  ▼
Supabase（Auth + Postgres + RLS）
```

| 層 | パス | 役割 |
|----|------|------|
| フロントエンド | `frontend/` | SPA。機能は `src/features/` 以下 |
| バックエンド | `backend/app/` | FastAPI。Gemini / Supabase / CSV |
| DB・Auth | `supabase/` / `db-contracts/` | Supabase設定・現行Writer経路のmigration files・アプリDB契約。共有migration正本はshared-supabase-db |
| Nginx | `nginx-config/` | 静的配信 + `/api/` リバースプロキシ |
| Compose | `docker-compose.production.yml` | 本番 FE + BE |
| PR品質チェック | `.github/workflows/ci.yml` | `main` 向けPRの作成・更新・再オープン時に frontend ESLint/build/test、backend Ruff check/format、unittest を実行。読み取り権限のみで、Secrets・本番DB・Docker push・deploy は使わない |
| main後CD | `.github/workflows/deploy.yml` | `main` push 後に quality を実行し、マイグレーション変更時は migrate → 読み取り専用RPC検証、その後 GHCR build → VPS deploy。VPSの `.env` は umask 077 で0600を確認した同一ディレクトリの一時ファイルから原子的に置換する。変更がなければ migrate と検証をスキップ。手動検証は `verify-production-rpcs.yml` |
| ドキュメント | `docs/` | 本ファイルおよび仕様メモ |

---

## 4. 機能一覧

ステータス凡例:

- **現行** … 本番相当で動いている
- **強化予定** … A として伸ばす
- **削除済み** … 履歴として言及する場合のみ

### 4.1 UI タブ（`frontend/src/components/MainLayout.tsx`）

| タブ | ラベル | ステータス | 概要 |
|------|--------|------------|------|
| `register` | 登録 | 現行 | レシート撮影 / 手動入力 / CSV 読込 |
| `history` | 履歴・管理 | 現行・強化予定 | 月次履歴、編集・削除、店舗・商品・タグ検索 |
| `chat` | AIチャット | 現行 | 家計データへの自然言語 Q&A |
| `dashboard` | 統計 | 現行 | 月次カテゴリ円グラフなど |

### 4.2 機能モジュール

| 領域 | パス | ステータス | できること |
|------|------|------------|------------|
| レシート | `frontend/src/features/receipt/` | 現行 | 画像 → `/analyze` → 編集（カテゴリ・タグ等）→ `/save`。まとめて解析は開始時点の待機タスクを登録順に1件ずつ実行。手動入力もあり |
| CSV | `frontend/src/features/csv/` | 現行 | CSV → 列マッピング（Gemini またはプリセット）→ 月ごとの `/save_csv`。1ファイルはヘッダーを含む論理行20,000行、20MiBまで。日付範囲の制限はなく、複数年を含められる |
| 履歴 | `frontend/src/features/history/` | 現行・強化予定 | 月選択、明細編集削除、テキスト検索。分類フィルタは [planned-history-category-filter.md](./planned-history-category-filter.md) |
| AIチャット | `frontend/src/features/search/` | 現行 | `/search` + `chat_messages` 履歴 |
| ダッシュボード | `frontend/src/features/dashboard/` | 現行 | `main_category` 集計。CSV は「キャッシュレス（未分類）」扱い |

### 4.3 バックエンド API（`backend/app/main.py`）

| Method | Path | 認証 | 用途 | ステータス |
|--------|------|------|------|------------|
| GET | `/` | 不要 | ヘルスチェック | 現行 |
| POST | `/analyze` | 要 | レシート画像の Gemini 解析 + 学習カテゴリ適用。1回10枚・1枚10MiB・合計12MiB・JPEG/PNG/WebPのみ（実データ判定）。HEIC/HEIFは明示拒否。全検証後に AI 利用枠を claim してから Gemini | 現行 |
| POST | `/save` | 要 | レシート・明細の保存 | 現行 |
| POST | `/search` | 要 | 家計 Q&A。データ取得・空結果・サイズ上限のあとに、Gemini が必要なときだけ AI 利用枠を claim | 現行 |
| GET | `/available_months` | 要 | データがある月一覧 | 現行 |
| GET | `/transactions` | 要 | 指定月のレシート + CSV | 現行 |
| POST | `/analyze_csv` | 要 | CSV 列推定・パース（マッピング未指定時は Gemini で列推定）。論理行20,000行または20MiB文字を超える入力は、解析と Gemini 呼び出しの前に拒否。AI 推定が必要なときだけ利用枠を claim | 現行 |
| POST | `/save_csv` | 要 | CSV 行保存。月ごとの分割送信はフロントの既存経路 | 現行 |
| PUT/DELETE | `/receipts/{id}` | 要 | レシート更新・削除 | 現行 |
| PUT/DELETE | `/csv_transactions/{id}` | 要 | CSV 行更新・削除 | 現行 |

認証ヘッダ: `x-supabase-token`（Supabase セッションの access token）。

APIエラー応答は既存のJSON形式を維持する。リクエスト検証エラーと認証ヘッダ欠落は FastAPI の `422`、明示的に無効な Supabase トークンは固定メッセージの `401`、予期しない処理・設定・外部サービスエラーは内部詳細を含まない固定メッセージの `500` を返す。エラーログには処理箇所のみを記録し、例外本文、プロンプト、CSV内容、認証情報、トークンは含めない。

CSVの上限はヘッダーを含む論理行20,000行、および `csv_text` 20MiB（20 × 1024 × 1024文字）です。行数超過の `422` は `CSVは20,000行以内にしてください。` です。引用符内の改行は1論理行です。UTF-8を優先し、不正なUTF-8はShift-JISとして読みます。既存の列プリセット（旧キーを含む）と、保存時に年月ごとに `/save_csv` する経路は維持します。20,000行を超えるファイルの分割、再開、重複排除は行いません。

検索の質問は500文字までです。対象データが検索用の行数・文字数上限に収まらない場合は、Geminiを呼ばず、期間を短くする固定の日本語 `422` を返します。チャット画面はその固定案内だけを表示し、サーバーの例外文は出しません。

GeminiクライアントのHTTPタイムアウトは120秒（SDKの `HttpOptions.timeout` はミリ秒で `120000`）で、`retry_options` 未指定は1回だけ試行します。

`/analyze`、`/search`、`/analyze_csv` は Gemini の直前に `ai_quota` の `claim_ai_request` が `granted` になったときだけモデルを呼びます。日次・同時実行の拒否は日本語の `429`、緊急停止・月次予算・DB 障害などは日本語の `503` です。成功時の応答形は変えません。設定または DB が使えなくても、AI 以外の API は起動したままです。詳細は [spec-ai-quota-database.md](./spec-ai-quota-database.md) です。

リクエスト本体の上限は、フロントのファイルサイズ20MiB、バックエンドの文字数20MiB、nginxの `client_max_body_size 20M` です。開発時のViteプロキシに追加の本体上限はありません。JSON化で引用符や改行、Shift-JISからUTF-8への展開が20MiBを超える場合、フロントは送信前に拒否し、本番nginxは413を返します。nginxの本体上限を20Mより大きくするかは未変更です。

レシート画像（`/analyze`）は CSV とは別上限。1リクエスト最大10枚、1枚10MiB、合計12MiB（12,582,912 bytes）。対応形式は JPEG / PNG / WebP（拡張子・申告 MIME に依存せず実データで判定）。HEIC/HEIF は非対応として日本語で変換を案内。画素数は 16,777,216 まで。生 12 MiB を **1 blob** として Base64 化すると 16,777,216 文字、最大 10 枚に分割して独立にエンコードした最悪時は 16,777,240 文字（仕様書の `worst_case_split_base64_char_count`）。プロンプト・`response_schema` 等の固定オーバーヘッド見積もり `GEMINI_RECEIPT_ANALYZE_FIXED_OVERHEAD_BYTES=512,000` を加えた保守的上限 17,289,240 bytes は Gemini inline の 20,000,000 bytes 未満。詳細は [spec-receipt-image-limits.md](./spec-receipt-image-limits.md)。

### 4.4 カテゴリ（A）

- Gemini 抽出時に `main_category` / `sub_category` を付与
- 同一 `item_name` の過去設定を学習して再適用（`get_learned_categories`）
- 主な `main_category` 例: 食費、日用品、交通・通信、衣服・美容、趣味・娯楽、医療・健康、住居・家具、その他
- `search_tags`（キーワード配列）でテキスト検索を補助
- **厳密比較の対象集合には使わない**（それは B の手動フォルダ）
- **予定**: 大分類・サブはテキスト検索に混ぜず、候補選択のフィルタにする → [planned-history-category-filter.md](./planned-history-category-filter.md)

---

## 5. データモデル（Supabase）

共有DB migrationの正本は `shared-supabase-db/supabase/migrations/`。このリポジトリには現行Writer経路との互換性のためmigration filesを保持する。DB管理責任の移管完了を意味しない。receipt-managerが必要とするDB契約は `db-contracts/receipt-manager.json`。
public data tableはRLS有効。各テーブルは概ね `user_id` → `auth.users` でユーザー分離。

Dev・Prodとも共有DB migration 14本の履歴はIN_SYNCで、Reader migrationも両環境に適用済み。本番ReaderのEnvironment設定済みで、shared-supabase-dbの本番Reader workflowによる読み取り専用検証も成功している。`scripts/check-migration-history.py` はローカルmigration versionとDB履歴を比較し、`migration_preflight_reader` はmigration履歴version列など必要最小限だけを読むNOLOGIN role。本番Writer経路は引き続きreceipt-managerにあり、Writer権限の移管は未実施。Environment、切替順序、復旧手順など既存の運用上の注意事項は [production-database-migration-gate.md](./production-database-migration-gate.md) を参照。

| テーブル | 概要 | 主なカラム | 備考 |
|----------|------|------------|------|
| `receipts` | レシート親 | `date`, `store_name`, `total_amount`, `payment_method` | 主キー `id` に加え `UNIQUE (user_id, id)` |
| `receipt_items` | 明細 | `item_name`, `price`, `main_category`, `sub_category`, `search_tags` | 主キー `id` に加え `UNIQUE (user_id, id)`。親レシートは `(user_id, receipt_id)` |
| `csv_transactions` | カード等の集約行 | `date`, `store`, `price` | 明細分割なし |
| `csv_presets` | CSV 列マッピングプリセット | `name`, `mapping` (jsonb) | FE から直アクセス可 |
| `chat_messages` | AI チャット履歴 | `role`, `content` | FE から直アクセス可 |

同一 Supabase に同居する価格比較テーブル（`price_folders`、`price_records`、`price_memo_items`）もこのマイグレーション群で管理する。所有者の一致は複合外部キーで保証する。

### 5.1 所有者整合（複合外部キー）

子行の `user_id` と参照先の所有者が一致しない参照を拒否する。既存の主キー `id` は維持し、親側に `UNIQUE (user_id, id)` を追加したうえで ID 単独の外部キーを置き換える。

| 子 | 親 | ON DELETE |
|----|----|-----------|
| `price_records (user_id, folder_id)` | `price_folders (user_id, id)` | CASCADE |
| `price_memo_items (user_id, folder_id)` | `price_folders (user_id, id)` | CASCADE |
| `price_records (user_id, receipt_item_id)` | `receipt_items (user_id, id)` | SET NULL (`receipt_item_id` のみ)。列は NULL 可（MATCH SIMPLE）。`user_id` は NOT NULL のまま |
| `receipt_items (user_id, receipt_id)` | `receipts (user_id, id)` | CASCADE |

- 正本: `supabase/migrations/20261009010000_owner_composite_foreign_keys.sql`
- 適用前診断（件数のみ、読み取り専用）: `supabase/diagnostics/owner_fk_integrity.sql`
- 不整合または欠損参照がある場合、制約変更の前に失敗する。行の修復・削除・付け替えはしない。失敗時はマイグレーション全体がロールバックされ、以前の外部キーが残る。

### 5.2 価格比較アプリの原子的な更新 RPC

`supabase/migrations/20261010010000_s1_08_atomic_price_operations.sql` は、price-memo が使う2つの `SECURITY INVOKER` RPC を追加する。どちらも `auth.uid()` と既存 RLS を使い、`authenticated` のみに実行権限を与える。

- `rename_price_store(p_store_id, p_name)` は所有店舗をロックし、店舗名と同じ旧名を持つ所有者の価格記録を原子的に更新する。実際に名前が変わった場合だけ記録の `updated_at` も更新し、新しい店舗行を返す。
- `reorder_price_memo_items(p_expected_folder_ids, p_folder_ids)` は現在順（`sort_order, created_at, id`）と希望順を比較し、古い一覧なら `PM001` で失敗する。短時間のテーブル書き込みロックで他の追加・削除・並び替えと直列化し、全件を一括更新する。
- RPC 定義後に PostgREST schema cache の再読込を通知する。
- 適用後の読み取り専用検証: `supabase/diagnostics/verify_s1_08_rpc_integrity.sql`。`pg_catalog` と `supabase_migrations` だけを見る。`20261010010000` が1件適用されていること、上記2関数の引数名・型・順序、戻り値（`public.price_stores` / `void`）、`SECURITY INVOKER`、空の `search_path`、`PUBLIC` と `anon` に実行権限がなく `authenticated` にはあることを満たさないとエラーになる。

### 5.3 Gemini AI 利用枠（`ai_quota`）

DB は private スキーマ `ai_quota` のみ。FastAPI は専用ロール `ai_quota_backend` の Session Pooler 接続から3つの RPC だけを呼ぶ。接続設定は `.env` とは別の `.env.ai-quota` に置く。

| オブジェクト | 概要 |
|--------------|------|
| `ai_quota.settings` | シングルトン。日次上限（OCR/chat/CSV 推定）、同時実行、月次実測コスト上限（micro-JPY）、単価・FX・リース・緊急停止・未知利用ブレーカー |
| `ai_quota.requests` | 冪等 `request_id` 単位の試行履歴（プロンプト・画像・CSV・モデル出力は保存しない）。未知利用の `unknown_at` を保持する |
| RPC | `claim_ai_request` / `renew_ai_lease` / `finish_ai_request`（`ai_quota_backend` のみ `EXECUTE`） |

- 正本: `supabase/migrations/20261014120000_s1_06_ai_quota_foundation.sql`
- 仕様: [spec-ai-quota-database.md](./spec-ai-quota-database.md)
- 未知利用ブレーカーの初期閾値は 3。同一 JST 日の未解決 `unknown_usage` だけを数え、日付境界で解除する。行は残し、日次回数は claim 日のまま。緊急停止と計測済み月額 800 円上限は維持する
- 適用前の読み取り専用権限 preflight: `supabase/diagnostics/preflight_ai_quota_migration_privileges.sql`。初回適用前だけ。`ai_quota_owner` または `ai_quota_backend` が既にある場合は不足として止め、マイグレーション自身も既存ロールを流用・変更しない。実行者は対象データベースの `CREATE` を owner ロールへ一時付与できる必要があり、読み取り専用のカタログ確認はその付与の成功を完全には証明できない。`rolcreaterole` や `CREATE WITH GRANT OPTION` だけでは本番適用を証明できない。`.github/workflows/preflight-ai-quota.yml` を `main` から手動実行し、同じ migration ロールの既存Secretsで確認する。preflight は migration 成功を保証しない。適用後は integrity verifier を使う
- 本番読み取り専用検証: `supabase/diagnostics/verify_s1_06_ai_quota_integrity.sql`（`verify-production-rpcs.yml` で S1-08 と併走）
- 隔離 SQL テスト: `scripts/run-ai-quota-sql-tests.sh`
- `ai_quota_backend` のパスワードは、認可された Supabase データベース管理者の psql で `\password ai_quota_backend` を実行し、エコーなしプロンプトで設定する。入力した値はセキュアなエディタで VPS の `.env.ai-quota`（`0600`）へ直接書き写す。シェルコマンド、SQL 履歴、ログ、リポジトリ、GitHub または VPS のデプロイ用環境変数には置かない。手順は [spec-ai-quota-database.md](./spec-ai-quota-database.md)

### 5.4 S1 F-01 テーブル権限

`20261015120000_s1_f01_revoke_excess_table_privileges.sql` は、既存9テーブルと `postgres` が `public` で作成する今後のテーブルについて、`anon`・`authenticated` の `TRUNCATE`、`REFERENCES`、`TRIGGER`、`MAINTAIN` を取り消す。CRUD、RLS、RPC、`service_role`、関数・シーケンスの権限は変更しない。migrationは実行ロール、対象テーブルの所有者・付与元、global default ACLを事前確認し、実効権限とCRUDを事後確認する。

- 読み取り専用検証: `supabase/diagnostics/verify_s1_f01_acl_integrity.sql`。既存の `verify-production-rpcs.yml` から S1-06/S1-08 と併せて実行する。
- `supabase_admin` の `public` default privilegesは変更しない。Supabase管理ロールが将来 `public` に作るテーブルには対象権限が残る可能性がある。検証SQLは残存する直接付与数を表示する。
- migrationを含むmainへのマージは既存CDから本番DBへの `supabase db push` を起動する。

### 5.5 price-memo のユーザー自身による全データ削除

`20261016100000_delete_my_price_memo_data.sql` は `public.delete_my_price_memo_data()` を追加する。引数を受け取らず `auth.uid()` がNULLなら拒否し、`SECURITY INVOKER` と既存RLSのもとで本人の `price_memo_items`、`price_records`、`price_folders`、`price_stores` だけを1回のRPC内で削除する。Authアカウント、レシート関連テーブル、他ユーザーの行は対象外。`PUBLIC`、`anon`、`service_role` の実行権限を取り消し、`authenticated` のみに付与する。

- 隔離SQLテスト: `scripts/run-price-memo-data-deletion-sql-tests.sh`。名前が指定条件に一致するlocalhost上の新規使い捨てPostgreSQL DBだけで実行する。ユーザー分離、未認証拒否、途中失敗のロールバック、Auth/receiptデータの維持、空データの成功、関数権限を確認する。
- 本マイグレーションを含む `main` へのマージは既存CDから本番DBへ自動適用される。price-memo側のUIを利用する前に、このmigrationが反映済みであることを確認する。

### 5.6 price-memo Private Broadcast 通知

`20261018120000_price_memo_private_broadcast.sql` は `price_folders`、`price_records`、`price_memo_items`、`price_stores` の変更を、ユーザー専用Private Broadcast `price-memo:user:<user_id>` へ通知する。payloadは対象表と操作種別のみ。price-memoクライアントがRLS付きAPIで再取得するための無効化通知であり、レコード同期や同時編集CASではない。

- `realtime.messages` に `authenticated` / `extension='broadcast'` / `auth.uid()` とtopic完全一致のSELECTポリシーのみ追加。クライアント送信権限、対象表Publication、既存RLS変更、Realtimeの全体Public access設定変更は行わない
- 4表の行triggerはINSERT/UPDATE/DELETEを処理し、所有者変更では旧・新ユーザーへ通知。フォルダCASCADEと `delete_my_price_memo_data()` の削除も子表を含め通知
- `realtime.send()` の失敗はSQLSTATEを警告記録して元のDMLを継続。切断・欠落時の再取得はprice-memo側の責務
- 隔離SQLテスト: `scripts/run-price-memo-private-broadcast-sql-tests.sh`。実Supabase RealtimeサーバーとのWebSocket結合テストではない
- 本マイグレーションを含む `main` へのマージは既存CDから本番DBへ自動適用される。本番適用前にRealtime設定・既存policy・権限とprice-memo側private購読を確認する。ロールバックは通知trigger・関数・policyを削除するforward migrationで行う

---

## 6. 技術スタック

バージョンは宣言値ベース。正確なロックは `package-lock.json` / `uv.lock` を参照。

### フロントエンド

| 技術 | 目安 |
|------|------|
| React | ^19.2 |
| TypeScript | ~5.9 |
| Vite | ^7.2 |
| Tailwind CSS | ^4.1 |
| Axios | ^1.13 |
| @supabase/supabase-js | ^2.97 |
| Recharts | ^3.8（ダッシュボードの円グラフ） |
| Node（Docker ビルド） | 22-alpine → nginx:alpine |

### バックエンド

| 技術 | 目安 |
|------|------|
| Python | >=3.10（Docker / 実行は 3.12） |
| FastAPI | >=0.124 |
| Uvicorn | >=0.38 |
| google-genai | >=1.53（モデル例: `gemini-3-flash-preview`） |
| psycopg | >=3.3（`psycopg[binary]` と `psycopg-pool`。AI 利用枠 RPC の非同期プール） |
| Pillow | >=11.0（レシート画像の形式・破損・画素数検証） |
| supabase (Python) | >=2.28 |
| Ruff | フォーマット・lint |
| パッケージ管理 | `uv` |

### インフラ・ツール

| 技術 | 用途 |
|------|------|
| Supabase | Auth / Postgres / RLS |
| Docker + Compose | 本番コンテナ |
| Nginx | SPA + `/api` プロキシ（`client_max_body_size 20M`） |
| GitHub Actions | `main` への push で migrate / GHCR push / VPS deploy |
| GitHub Actions 手動 workflow | main から本番DBのAI利用制御 migration 権限を読み取り専用で事前確認 |
| 品質チェック | リポジトリルートで `npm run check` |
| Supabase CLI | `npm run db:plan`（linked 開発プロジェクトの dry-run 確認） / `db:push` / `db:list` |

※ `gspread` は依存に残っているが、アプリ本体からは未使用。

---

## 7. 環境・起動

### 7.1 ローカル開発

リポジトリルート:

```bash
npm run dev
# FRONT: Vite（frontend）
# BACK:  uv run uvicorn app.main:app --reload（backend）
```

- 開発時、Vite は `5174`（`strictPort`）で起動し、`/api` を `http://localhost:8000` へプロキシ。`npm run dev` は起動前に両ポートを検査し、競合時は所有プロセス情報を表示できる範囲で表示して停止。別ポートへの自動切替や既存プロセスの終了は行わず、Ctrl+C・SIGTERM・片側起動失敗時はこの起動が作成したプロセス群だけを終了する。SIGTERM後に終了確認し、必要なSIGKILL後も期限付きで再確認する。所有権・終了状態・`/proc` のいずれかを確認できない場合はcleanup失敗をstderrと終了コードに反映する
- `scripts/worktree.sh remove` は確認プロンプト前と削除直前に `/proc` のcwdを検査し、対象worktree内の稼働プロセスや検査不能な同一ユーザーPIDがあれば削除を拒否する。cwdを読めず関連を確認できないPIDは検出限界として扱う。詳細は [worktree-development.md](./worktree-development.md)
- `npm run dev` は起動前に、固定された開発Supabase refとVite・backend双方の実効URLを照合。URLのプロセス環境変数上書き、Viteの優先dotenvファイル、backend dotenv内の不一致・曖昧な設定では値を表示せず停止
- ブラウザからの API 呼び出しは同一オリジンの `/api`（Vite / nginx 経由）のみ。FastAPI は CORS を有効化しない
- DB 計画確認: `npm run db:plan`（DB専用env準備、許可された開発ref、共有 `frontend/.env` と worktree symlink/URL、worktree linkを照合し、migration listとdry-runを実行。`frontend/.env` が未作成の worktree では共有設定への symlink を自動作成）
- DB 反映: `npm run db:push`（同じ接続先検証、dry-run表示、TTYで `apply` 入力後に適用。`SUPABASE_DB_PASSWORD` は環境変数または非表示プロンプト。明示依頼時のみ）

### 7.2 環境変数

追加worktreeの保存先、開発設定のsymlink、依存関係セットアップ、Cursor委譲の手順は [worktree-development.md](./worktree-development.md) を参照。`.env.ai-quota`、CA、service account、本番設定は標準worktreeセットアップの対象外。

**フロント（`frontend/.env`、Docker ビルド時に焼込）**

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- API はクライアント側で `baseURL: '/api'` 想定

**バック（ローカル `.env` / 本番 compose の `env_file`）**

- `GEMINI_API_KEY`
- `SUPABASE_URL` または `VITE_SUPABASE_URL`
- `SUPABASE_KEY` または `VITE_SUPABASE_PUBLISHABLE_KEY`

AI 利用枠の DB 接続は `.env` に混ぜず、gitignore 対象の `.env.ai-quota` に置く。

- `AI_QUOTA_DB_HOST`
- `AI_QUOTA_DB_PORT`（`5432`）
- `AI_QUOTA_DB_NAME`（`postgres`）
- `AI_QUOTA_DB_USER`（`ai_quota_backend.<project-ref>`）
- `AI_QUOTA_DB_PASSWORD`（対話式 `\password` で入力した値を、`0600` の `.env.ai-quota` へ直接記入する。デプロイ用環境変数には置かない）
- `AI_QUOTA_DB_SSLROOTCERT`（本番コンテナ内は `/app/secrets/ai-quota-ca/supabase-root.crt`）

`.env`、`.env.ai-quota`、`secrets/ai-quota-ca/`、および `service_account.json` は gitignore 対象。パスワードと CA はコミットしない。本番 compose はホストの `~/receipt-manager/secrets/ai-quota-ca` をコンテナの `/app/secrets/ai-quota-ca` へ読み取り専用でマウントする。ディレクトリが無くても API プロセスは起動し、AI エンドポイントだけが 503 になる。手順は [spec-ai-quota-database.md](./spec-ai-quota-database.md)。

### 7.3 本番

- イメージ: `ghcr.io/nakakonakako/receipt-manager-frontend|backend:latest`
- `docker-compose.production.yml` で FE は既定 network と外部 `edge` network に参加し、ホストポートは公開しない。edge-proxy は `edge` 経由で FE の `:80` に接続し、FE は既定 network 経由で BE の `:8000` に接続
- PR時の品質チェック: `.github/workflows/ci.yml` が `main` 向けPRの opened / synchronize / reopened で `npm run check` を実行する。Node.js 22、uv / Python 3.12 とロック済み依存関係を使い、frontend ESLint/test/build、backend Ruff check/format、backend unittest を検証する。`contents: read` のみ許可し、本番Secrets・DB接続・migration・Docker push・VPS deploy は行わない。
- main push後のCD: `.github/workflows/deploy.yml` は全main pushでmigration履歴とreader roleを読み取り専用で検証する。履歴一致時はRPC/ACL検証成功後に承認なしでbuild/deployを続ける。未適用migration時はRPC/ACLのassertion mismatchだけを修復経路として許容し、`production-db-apply` Environmentの本人承認付きapply後に全検証を再実行する。接続・履歴・reader・検証実行エラーやpostflight失敗ではdeployしない。全DB操作とdeployは共通queueで直列化する。
- 本番DB credentialは用途別Environmentに分離する。`production-db-check` はmain限定・承認なしの読み取り専用login、`production-db-apply` はmain限定・本人承認付きのwriter secretを持つ。ReaderはDev・Prodに適用済みで、本番Environment設定とshared-supabase-dbの読み取り専用workflowによる検証が完了している。Writer権限はreceipt-managerに残っている。
- Environment設定順、reader bootstrapの経緯、旧repository secret削除条件、失敗復旧は [production database migration gate](./production-database-migration-gate.md) を参照する。main push後のpreflight・migration gateが失敗した場合は、記載のfail-closed動作によりproduction deployへ進まない。

### 7.4 認証フロー

1. Google OAuth（Supabase Auth）
2. セッションを FE の Auth Context で保持
3. API 呼び出し時に `x-supabase-token` を付与
4. BE がそのトークンでユーザー文脈の Supabase クライアントを構築
5. 一部テーブル（チャット・CSV プリセット）は FE が RLS 経由で直接 CRUD

レシート登録の一時アップロード状態は Supabase の `session.user.id` を所有者として保持する。同じユーザーのタブ移動やトークン更新では維持し、ログアウト・ユーザー切替では解析結果、画像、編集状態、カメラ中のデータとプレビュー URL を破棄する。まとめて解析は、開始操作の時点で待機中のタスクだけを登録順に1件ずつ実行する。実行中に追加したタスクは次の開始操作まで含めず、1件が失敗しても同じ所有者の後続は続ける。成功済み・失敗・解析中は自動では再解析しない。ログアウトやユーザー切替で世代が変わると、未開始分は始めず、古い世代の結果でも状態を更新しない。進行中の通信を中断できなくても次のタスクは始めない。連打や画面の再マウントでは同じキューを二重起動しない。レシート解析の HTTP 429 は、日次上限と同時実行上限の既知の固定文言に完全一致したときだけ個別に案内する。未知の内容、欠落、文字列でない `detail` は一般的な利用制限として案内し、応答本文は表示しない。

---

## 8. ディレクトリガイド（ざっくり）

```
receipt-manager/
├── frontend/          # React SPA
│   └── src/
│       ├── components/    # レイアウト、認証、登録ハブなど
│       ├── features/      # 機能単位（receipt, csv, history, …）
│       ├── hooks/
│       └── lib/           # apiClient 等
├── backend/
│   └── app/
│       ├── main.py
│       ├── schemas/
│       └── services/      # gemini, supabase, csv
├── supabase/migrations/
├── supabase/diagnostics/
├── supabase/tests/ai_quota/
├── nginx-config/
├── docs/              # 本ドキュメント群
└── docker-compose.production.yml
```

---

## 9. 関連ドキュメント

| 文書 | 内容 |
|------|------|
| [README.md](./README.md) | docs 索引 |
| [spec-split-receipt-and-unit-price.md](./spec-split-receipt-and-unit-price.md) | A/B 分離・メモ削除・カテゴリ方針 |
| [planned-history-category-filter.md](./planned-history-category-filter.md) | 予定: 履歴の分類フィルタ構想 |
| [spec-ai-quota-database.md](./spec-ai-quota-database.md) | Gemini 利用枠 DB と FastAPI の3エンドポイント統合 |
| [spec-worktree-runtime.md](./spec-worktree-runtime.md) | worktree仮想環境管理と開発DB dry-run |
| [spec-price-memo-realtime.md](./spec-price-memo-realtime.md) | price-memo向けPrivate Broadcast通知のtopic・認可・trigger契約 |

新規の仕様・設計メモを足したら、上記索引と本節にも行を追加する。

---

## 10. 変更履歴（このドキュメント）

| 日付 | 内容 |
|------|------|
| 2026-10-28 | receipt-managerのDB互換性契約v1とv1検証外の統合テスト対象を追加 |
| 2026-10-23 | worktree削除前後にcwdベースの稼働プロセス検査を追加 |
| 2026-10-23 | 開発サーバーの所有プロセス群について、SIGKILL後の終了確認とcleanup失敗の報告を追加 |
| 2026-10-20 | 開発Supabase refの明示登録、receipt-managerのmigration dry-run計画、worktree移動後のPython仮想環境復旧を追加 |
| 2026-10-19 | Git worktree環境設定の明示移行、起動前検証、`origin/main`基準のCursor worktree作成を追加 |
| 2026-10-18 | price-memo 4表のPrivate Broadcast無効化通知と本人topic限定の受信policyを追加 |
| 2026-10-16 | price-memoに本人の4テーブルだけを削除する認証済みSECURITY INVOKER RPCと隔離SQLテストを追加 |
| 2026-10-15 | S1 F-01: APIロールのテーブル過大権限を既存表と `postgres` の `public` default privilegesから取り消し、読み取り専用検証を本番workflowへ追加 |
| 2026-10-15 | レシート解析の HTTP 429 を日次上限・同時実行上限・未知の利用制限に分類し、未知の応答本文は表示しない |
| 2026-10-15 | レシートのまとめて解析を登録順の逐次実行にし、世代が変わった未開始分は始めない |
| 2026-10-15 | `ai_quota_backend` のパスワード設定を、対話式 psql `\password` と保護された `.env.ai-quota` への直接記入に限定 |
| 2026-10-15 | 本番 compose に AI 利用枠 CA ディレクトリの読み取り専用マウントを追加。欠ける場合もバックエンドは起動し、AI だけ 503 |
| 2026-10-15 | `/analyze`、`/search`、`/analyze_csv` を `ai_quota` RPC と専用 `.env.ai-quota` 接続に統合。設定が無いときは AI だけ 503 |
| 2026-10-15 | AI利用制御 migration の本番DB権限を手動・読み取り専用で確認する workflow を追加 |
| 2026-10-14 | AI 利用枠 migration の一時 SET membership 検証をSupabaseのPG17自動ADMIN membershipに合わせ、readonly preflightと仕様の制約説明を更新 |
| 2026-10-14 | AI 利用枠 preflight を初回適用前に限定し、既存 `ai_quota` ロールがある場合は不足として止める。操作ごとの権限要件を仕様へ追記 |
| 2026-10-14 | 未知利用ブレーカーを同一 JST 日・初期閾値 3 に限定し、マイグレーション権限の読み取り専用 preflight を追加 |
| 2026-10-14 | S1-06 PR 2A: `ai_quota` スキーマ・利用枠 RPC・本番読み取り検証・隔離 SQL テスト（FastAPI 統合は別 PR） |
| 2026-10-13 | レシート画像 `/analyze` の枚数・サイズ・形式検証（JPEG/PNG/WebP、HEIC/HEIF 拒否）を追加 |
| 2026-10-12 | ログアウト・アカウント切替時にレシート登録の一時データとプレビュー URL を破棄 |
| 2026-10-11 | S1-04: 予期しないAPI例外・認証エラーの詳細を応答やログに露出しないよう修正 |
| 2026-10-10 | `main` 向けPRに読み取り専用の品質チェックを追加し、PR時CIとmain後CDの役割を文書化 |
| 2026-10-10 | 本番の価格RPCをマイグレーション成功後に読み取り検証。Session Pooler ホスト変数が無ければ検証は失敗する |
| 2026-10-10 | price-memo用の店舗改名・買い物メモ並び替えRPCを追加し、更新を原子的に実行 |
| 2026-10-10 | `/analyze_csv` にSupabase認証とCSV入力・Geminiサンプルのサイズ上限を追加 |
| 2026-10-09 | レシート・価格フォルダ参照を所有者付き複合外部キーへ置換。診断 SQL は `supabase/diagnostics/owner_fk_integrity.sql` |
| 2026-09-26 | 本番 FE を外部 `edge` network に追加し、edge-proxy からの Docker 内部 DNS 接続を有効化 |
| 2026-09-26 | 本番 FE のホスト側 `80:80` を廃止し、deploy 時のコマンド失敗と FE/BE コンテナ停止を検出 |
| 2026-09-26 | CI の Docker / Supabase setup Action を Node.js 24 対応版へ更新。frontend Dockerfile の stage 表記を統一 |
| 2026-08-25 | 履歴の分類フィルタ構想を `planned-history-category-filter.md` に保管 |
| 2026-08-25 | メモ機能・`is_comparable`・`memo_rows` を削除。値段推移は B 側へ移管する方針 |
| 2026-08-25 | 初版。A の目的・機能・環境・A/B 境界を整理。メモは削除予定として記載 |
