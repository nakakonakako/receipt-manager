# Gemini AI 利用枠データベース（S1-06 PR 2A）

FastAPI 統合は別 PR。本 PR は `ai_quota` スキーマのマイグレーション、RPC、診断 SQL、隔離 SQL テストのみ。

## 目的

バックエンドが Gemini を呼ぶ前に、日次・同時実行・月次実測コストで **失敗時閉鎖（fail closed）** の枠を確保し、同一 `request_id` の再試行でモデルを二重起動しない。プロンプト・画像・CSV 本文・モデル出力は **一切永続化しない**。

## スキーマとロール

| オブジェクト | 説明 |
|--------------|------|
| `ai_quota.settings` | シングルトン（`id = 1`）。日次上限（種別ごと user/global）、同時実行上限、月次実測コスト上限（micro-JPY）、単価スナップショット元、FX、リース秒数、未知利用ブレーカー、緊急停止 |
| `ai_quota.requests` | 1 回の AI 試行。`request_id` はサーバ発行の冪等キー。JST 日/月、状態、リース、トークン（測定時のみ）、micro-JPY コスト、請求時点の単価・モデルスナップショット |
| `ai_quota_owner` | NOLOGIN。スキーマ・表・関数の所有者 |
| `ai_quota_backend` | LOGIN（**パスワードはリポジトリ外で手動設定**）。`USAGE` on `ai_quota` と 3 RPC の `EXECUTE` のみ。表への直接権限なし |

`PUBLIC` / `anon` / `authenticated` / `service_role` からはスキーマ・表・RPC を剥奪。

## デフォルト（マイグレーション挿入値）

| 項目 | 値 |
|------|-----|
| OCR / chat 日次 | 20 user / 50 global（各） |
| CSV 列推定日次 | 5 user / 20 global |
| 同時実行 | 1 user / 3 global |
| 月次実測コスト上限 | `800_000_000` micro-JPY（800 円） |
| モデル | `gemini-3-flash-preview` |
| 入力単価 | USD 0.50 / 1M tokens |
| 出力・思考単価 | USD 3.00 / 1M tokens |
| FX | 200 JPY/USD |
| リース | 240 秒 |
| 未知利用ブレーカー | 未解決の `unknown_usage` が設定閾値（初期1件）以上なら新規 claim を拒否。月をまたいでも維持し、運用者が精算・照合して解決するまで解除しない |
| 固定費予約 | **なし** |

## RPC 振る舞い

すべて `SECURITY DEFINER`、`search_path` 空、識別子は `ai_quota.` で完全修飾。

### `claim_ai_request(request_id, user_id, kind)`

1. `settings` 行を `FOR UPDATE`（設定欠落は例外で fail closed）。
2. ロック取得後のみ `clock_timestamp()` と JST 日/月を算出。
3. 既存 `request_id` は同一 user/kind なら `idempotent`（再モデル起動不可）。不一致なら `rejected` / `idempotency_conflict`。
4. 緊急停止、未知利用ブレーカー、日次 user/global、**未期限リースのみ**の同時実行数、当月 `succeeded` / `failed` の実測コスト合計と上限を検査。
5. 成功時 `active` 行を挿入し単価スナップショットを固定。

### `renew_ai_lease(request_id)`

`settings` を直列化用にロック。`active` かつリース未失効のみ延長。失効後の更新は `lease_expired`。

### `finish_ai_request(request_id, succeeded, usage_available, input/output/thought tokens)`

`usage_available = false` → `unknown_usage`（トークン・コスト NULL。ゼロ円成功扱いしない）。

`usage_available = true` → 成功なら `succeeded`、Gemini呼び出し失敗なら `failed` とし、どちらもスナップショット単価で micro-JPY コスト算出（入力 + 出力 + 思考。`total_tokens` は履歴値で、請求には加えない。キャッシュトークンは入力に含めて保守的に評価）。総トークン数は入力・出力・思考の合計を保存。

終了済みの同一内容は `idempotent`。内容不一致は `finish_conflict`。リース失効後の測定 finish は許可（同時枠を再取得しない）。

## コスト計算

整数演算: 各トークン数 × 当時の micro-USD/1M tokens を合算し、× `fx_jpy_per_usd`、÷ 10⁶ を **切り上げ**。

## 失敗・復旧

| 状況 | 挙動 |
|------|------|
| リース失効 | 次回のclaim時に`unknown_usage`へ更新。同時枠は解放し、日次カウント・履歴は維持。遅れてusageが届けば元の予約を精算 |
| 未知利用 | `unknown_usage` として保持。トークン・費用はNULL。未解決レコードは月をまたいでもブレーカーを作動させ、運用者の照合まで新規claimを停止 |
| 緊急停止 | 新規 claim 拒否。既存行の finish は可能 |
| 冪等 claim | 既存行を返すのみ |

## 月次コスト上限の限界

上限は **`succeeded` / `failed` かつコスト非 NULL** の合計のみ。進行中リースや未知利用は含まず、固定費引当もしないため、許可済み処理の完了で800円を超える可能性があり、超過額の上限も保証しない。Googleの実請求額が推定額以下とも保証しない。

## マイグレーションと本番

- 正本: `supabase/migrations/20261014120000_s1_06_ai_quota_foundation.sql`
- `main` へマイグレーション付き push 時、既存 CD は `supabase db push` 後に読み取り専用検証を実行（S1-08 + 本 PR の `verify_s1_06_ai_quota_integrity.sql`）。
- PostgREST 公開スキーマは変更なし（`ai_quota` は API に出さない）。

## 本番セットアップ（手動・リポジトリ外）

1. マイグレーション適用後、Supabase SQL または運用手順で `ai_quota_backend` に強力なパスワードを設定（マイグレーションには含めない）。
2. FastAPI（別 PR）からはこのロール専用の接続文字列を使い、3 RPC のみ呼び出す。
3. `settings` の調整はスーパーユーザーまたは運用ロールで直接更新（バックエンドに表権限を付けない）。

## 検証

| 種別 | パス |
|------|------|
| 本番読み取り専用 | `supabase/diagnostics/verify_s1_06_ai_quota_integrity.sql` |
| 隔離 SQL テスト | `scripts/run-ai-quota-sql-tests.sh`（ローカル Supabase または `AI_QUOTA_TEST_DATABASE_URL`） |
| 並行プローブ | `supabase/tests/ai_quota/test_concurrent_claim.sh`（実 Postgres 上の簡易試験。一般同時実行の証明ではない） |

SQL テストは既存の開発Supabaseをresetしない。空の使い捨てPostgreSQL databaseを作り、`AI_QUOTA_TEST_ALLOW_DISPOSABLE_DB=YES` と、loopback上の `ai_quota_test` を指す `AI_QUOTA_TEST_DATABASE_URL` を明示してから実行する。
