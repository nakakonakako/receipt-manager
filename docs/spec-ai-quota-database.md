# Gemini AI 利用枠データベース（S1-06 PR 2A）

FastAPI 統合は別 PR。本 PR は `ai_quota` スキーマのマイグレーション、RPC、診断 SQL、隔離 SQL テストのみ。

## 目的

バックエンドが Gemini を呼ぶ前に、日次・同時実行・月次実測コストで **失敗時閉鎖（fail closed）** の枠を確保し、同一 `request_id` の再試行でモデルを二重起動しない。プロンプト・画像・CSV 本文・モデル出力は **一切永続化しない**。

## スキーマとロール

| オブジェクト | 説明 |
|--------------|------|
| `ai_quota.settings` | シングルトン（`id = 1`）。日次上限（種別ごと user/global）、同時実行上限、月次実測コスト上限（micro-JPY）、単価スナップショット元、FX、リース秒数、未知利用ブレーカー、緊急停止 |
| `ai_quota.requests` | 1 回の AI 試行。`request_id` はサーバ発行の冪等キー。JST 日/月、状態、リース、トークン（測定時のみ）、micro-JPY コスト、請求時点の単価・モデルスナップショット、`unknown_at`（未知利用になった時刻。明示 finish では finish 時刻、期限切れ sweep では `lease_expires_at`） |
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
| 未知利用ブレーカー | 同一 JST 日の未解決 `unknown_usage` が設定閾値（初期 3 件）以上なら新規 claim を拒否。件数は `unknown_at` の JST 日で数える。日付が変わると自動解除する。古い行は削除せず、日次回数は claim 時の `jst_day` のまま消費済み。`unknown_usage` は日次回数を返さない |
| 固定費予約 | **なし** |

初期閾値3件は、単発のGemini timeoutや通信障害で全ユーザーを止める運用負担を避けつつ、同じ日に未知利用が連続した際は後続claimを止める折衷値である。3件目を作るclaimは開始済みなので、その費用は止められない。ブレーカーは翌JST日開始に自動解除し、過去行と日次回数消費は保持する。後からusageが判明した場合は行を精算状態に変え、履歴の`unknown_at`は残して未解決件数から外す。未知費用は推定できず、月800円の計測済み上限に含まれないため、この閾値は実請求額の上限保証ではない。異常が続く場合の停止は緊急停止フラグで行い、閾値の変更・緊急停止解除はDB運用者が行う。

## RPC 振る舞い

すべて `SECURITY DEFINER`、`search_path` 空、識別子は `ai_quota.` で完全修飾。

### `claim_ai_request(request_id, user_id, kind)`

1. `settings` 行を `FOR UPDATE`（設定欠落は例外で fail closed）。
2. ロック取得後のみ `clock_timestamp()` と JST 日/月を算出。
3. 既存 `request_id` は同一 user/kind なら `idempotent`（再モデル起動不可）。不一致なら `rejected` / `idempotency_conflict`。
4. 緊急停止、同一 JST 日の未知利用ブレーカー、日次 user/global、**未期限リースのみ**の同時実行数、当月 `succeeded` / `failed` の実測コスト合計と上限を検査。検査と挿入は `settings` 行ロックを保持したまま行う。
5. 成功時 `active` 行を挿入し単価スナップショットを固定。

### `renew_ai_lease(request_id)`

`settings` を直列化用にロック。`active` かつリース未失効のみ延長。失効後の更新は `lease_expired`。

### `finish_ai_request(request_id, succeeded, usage_available, input/output/thought tokens)`

`usage_available = false` → `unknown_usage`（トークン・コスト NULL。ゼロ円成功扱いしない）。`unknown_at` と `finished_at` は finish 時刻。

`usage_available = true` → 成功なら `succeeded`、Gemini呼び出し失敗なら `failed` とし、どちらもスナップショット単価で micro-JPY コスト算出（入力 + 出力 + 思考。`total_tokens` は履歴値で、請求には加えない。キャッシュトークンは入力に含めて保守的に評価）。総トークン数は入力・出力・思考の合計を保存。未知利用だった行を後から精算した場合も状態は `succeeded` / `failed` になりブレーカー対象から外れる。`unknown_at` は履歴として残す。

終了済みの同一内容は `idempotent`。内容不一致は `finish_conflict`。リース失効後の測定 finish は許可（同時枠を再取得しない）。

## コスト計算

整数演算: 各トークン数 × 当時の micro-USD/1M tokens を合算し、× `fx_jpy_per_usd`、÷ 10⁶ を **切り上げ**。

## 失敗・復旧

| 状況 | 挙動 |
|------|------|
| リース失効 | 次回の claim 時に `unknown_usage` へ更新する。`unknown_at` は `lease_expires_at`。同時枠は解放し、日次カウント・履歴は維持する。数日前に失効したリースを今日初めて検出しても、今日のブレーカー件数には含めない。遅れて usage が届けば元の予約を精算する |
| 未知利用 | `unknown_usage` として保持。トークン・費用は NULL。同一 JST 日に未解決が閾値（初期 3）以上あるときだけ新規 claim を止める。翌日は自動解除する。緊急停止と、計測済み月額 800 円上限は別条件として維持する |
| 緊急停止 | 新規 claim 拒否。既存行の finish は可能 |
| 冪等 claim | 既存行を返すのみ |

## 月次コスト上限の限界

上限は **`succeeded` / `failed` かつコスト非 NULL** の合計のみ。進行中リースや未知利用は含まず、固定費引当もしないため、許可済み処理の完了で800円を超える可能性があり、超過額の上限も保証しない。Googleの実請求額が推定額以下とも保証しない。

## マイグレーションと本番

- 正本: `supabase/migrations/20261014120000_s1_06_ai_quota_foundation.sql`
- `main` へマイグレーション付き push 時、既存 CD は `supabase db push` 後に読み取り専用検証を実行（S1-08 + 本 PR の `verify_s1_06_ai_quota_integrity.sql`）。preflight は適用後の検証ではない。
- PostgREST 公開スキーマは変更なし（`ai_quota` は API に出さない）。

## マイグレーション操作ごとの権限要件

正本マイグレーションは単一トランザクションで行う。順は、ロール作成、一時 SET membership、一時的なデータベース `CREATE`、スキーマ作成、その `CREATE` の即時 `REVOKE`、`SET LOCAL ROLE ai_quota_owner` の下での表・関数作成、一時 SET membership の `REVOKE` である。`ALTER ROLE` と `OWNER TO` は使わない。Supabase の `postgres` は superuser ではない。セッションユーザー自身として実行する（事前の `SET ROLE` の下では失敗する）。

単一の `pg_roles.rolcreaterole` が true であることだけでは、このマイグレーションを本番に適用できる証明にならない。次の操作は別々の権限であり、どれか一つからは残りを導けない。

### CREATE ROLE

- `ai_quota_owner` または `ai_quota_backend` が既にあれば、preflight もマイグレーション自身も失敗する。既存ロールの流用も属性変更もしない。
- 未存在なら、必要属性を指定した `CREATE ROLE` を各ロール1回だけ実行する。`ai_quota_owner` は NOLOGIN / NOINHERIT / NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS。`ai_quota_backend` は LOGIN で、それ以外は同じ非特権属性。パスワードは入れない。
- `CREATE ROLE` には superuser、または実行ロールの `rolcreaterole` が必要。`rolcreatedb` はデータベース作成権限であり、ロール作成の代替ではない。
- Supabase local PostgreSQL 17.6 では、ロール作成時にbootstrap superuser `supabase_admin` をgrantorとして、migration接続の `postgres` に `ADMIN TRUE`, `SET FALSE`, `INHERIT FALSE` のmembershipが自動作成された。`postgres` から `REVOKE ... GRANTED BY supabase_admin` は拒否された。grantor名やこの動作は環境固有のため、migration/preflightは特定名に依存しない。readonly preflightだけではこの挙動を事前証明できない。
- PostgreSQL 17 では新ロールの作成者に `SET ROLE` できるmembershipが自動で付かないため、migrationは実行ロールへ `ai_quota_owner` の一時membership (`SET TRUE`, `INHERIT FALSE`, `ADMIN FALSE`) を付け、commit前にこの付与を取り消す。Supabaseが別grantorで付与する `ADMIN TRUE`, `SET FALSE`, `INHERIT FALSE` membershipは残る可能性がある。これは信頼済みmigration管理ロールだけに対するロール管理権限で、backendや利用者へowner権限を付与しない。ただし管理ロール自身が将来SET membershipを再付与できるため、ownerとの強い管理者分離は保証しない。`ai_quota_owner` 自身のNOLOGIN / NOINHERITは変えない。

### CREATE SCHEMA / AUTHORIZATION と一時的なデータベース CREATE

- `CREATE SCHEMA ai_quota AUTHORIZATION ai_quota_owner` は `SET LOCAL ROLE ai_quota_owner` のあとで行う。その間だけ、対象データベースの `CREATE` を `ai_quota_owner` に付与する。スキーマ作成の直後に実行ロールへ戻り、同じ `CREATE` を `REVOKE` する。
- データベース名は `format('%I', current_database())` で識別子として quote し、動的 SQL に渡す。
- この一時付与を実行できるのは、対象データベースの所有者、superuser、またはそのデータベースの `CREATE WITH GRANT OPTION` を持つロールである。実行者自身の `CREATE` や `rolcreaterole` では置き換えられない。
- まだ存在しないロールへの membership と、そのロールへの `GRANT CREATE` が成功するかは、適用前のカタログでは確定しない。
- スキーマ作成後、`PUBLIC` / `anon` / `authenticated` / `service_role` からスキーマ権限を剥奪する。表と関数はその後も `SET LOCAL ROLE ai_quota_owner` の下で作る。所有者として作るため `OWNER TO` は不要である。

### SECURITY DEFINER

- `claim_ai_request` / `renew_ai_lease` / `finish_ai_request` は `SECURITY DEFINER` かつ所有者 `ai_quota_owner`。ヘルパー関数も所有者は `ai_quota_owner`。すべての関数は空の `search_path`。
- 実行時の権限は所有者 `ai_quota_owner` の権限である。呼び出し側 `ai_quota_backend` に付与するのはスキーマ `USAGE` と 3 RPC の `EXECUTE` のみ。
- 定義は `ai_quota.` および `pg_catalog.` の完全修飾識別子で search_path の乗っ取りを避ける。role flag の確認はこの安全性の確認にならない。
- commit 前に `RESET ROLE` し、migration が実行ロールへ付けた一時 `SET` membership を `REVOKE` する。失敗すればトランザクション全体が戻るため、その一時 membership と `ai_quota_owner` のデータベース `CREATE` は残らない。Supabase bootstrap による ADMIN-only membership が残っても `SET` / `INHERIT` はなく、backend や利用者へ owner 権限を付与しない。ただし信頼済みmigration管理ロール自身はADMIN権限を持ち、将来SET membershipを再付与できる。
- membership を外したあとも、適用後の読み取り専用検証が singleton 行を読めるよう、実行ロールには `ai_quota` の `USAGE` と `ai_quota.settings` の `SELECT` だけを残す。表の書き込みと RPC の `EXECUTE` は付けない。

## 適用前 preflight

`supabase/diagnostics/preflight_ai_quota_migration_privileges.sql` は、このマイグレーションを適用する前の確認に限る。読み取り専用トランザクションで、ロール変更、DDL、DML をしない。パスワード、接続文字列、ホスト、ポートは出さない。本番のデータを変更しない。

確認できること:

- 実行ロールが `pg_roles` から見えること、`rolsuper` と `rolcreaterole` を含む role flags
- 現在のデータベースに対する `CREATE`
- 実行ロールの membership と ADMIN OPTION
- `ai_quota_owner` / `ai_quota_backend` / `anon` / `authenticated` / `service_role` の有無と、存在するロールの flags
- `ai_quota` スキーマと関数が既にある場合の所有者、および関数の `SECURITY DEFINER`

限界:

- 例外なく終わっても、`CREATE ROLE`、実行ロールへの一時 SET membership、`ai_quota_owner` への一時的なデータベース `CREATE`、`CREATE SCHEMA ... AUTHORIZATION`、`SET ROLE`、`SECURITY DEFINER` 関数の作成が成功するとは断定できない。
- `rolcreaterole` の真偽だけでは本番適用を証明できない。未作成ロールへの membership、対象データベースの `CREATE` をそのロールへ `GRANT` できること、スキーマ所有者としての関数作成は、この表示だけでは確定しない。
- マイグレーションは対象データベースの `CREATE` を `ai_quota_owner` へトランザクション中だけ付与する。実行者はそれを `GRANT` できる必要がある。`CREATE WITH GRANT OPTION` がカタログ上で真でも、読み取り専用チェックはその一時 `GRANT` / `REVOKE` の成功を完全には証明できない。
- 適用後の状態確認は preflight の責務ではない。適用後は `verify_s1_06_ai_quota_integrity.sql` を使う。

実行手順:

1. マイグレーションを適用するのと同じロールで、適用前にこのファイルを一度だけ実行する。
2. `ai_quota_owner` または `ai_quota_backend` が既にある場合、preflight は `insufficient` で失敗する。既存ロールの ALTER や流用へ進まない。
3. 例外、`insufficient`、表示の欠落、または判断できない結果なら、マイグレーション適用とデプロイを止める。
4. 現行の `.github/workflows/deploy.yml` は `supabase db push` の前に preflight を実行しない。`migrate` ジョブは link のあと `supabase db push --yes --linked` のみである。運用者が同じ migration ロールで手動実行する。隔離 SQL テスト以外で secrets や本番接続を使わない。

## 本番セットアップ（手動・リポジトリ外）

1. 上記の適用前 preflight を、マイグレーションと同じロールで実行する。
2. preflight が失敗した、例外になった、または結果を判断できない場合は、適用とデプロイを止める。
3. マイグレーション適用後、Supabase SQL または運用手順で `ai_quota_backend` に強力なパスワードを設定（マイグレーションには含めない）。
4. FastAPI（別 PR）からはこのロール専用の接続文字列を使い、3 RPC のみ呼び出す。
5. `settings` の調整はスーパーユーザーまたは運用ロールで直接更新（バックエンドに表権限を付けない）。

## 検証

| 種別 | パス |
|------|------|
| 適用前の権限 preflight | `supabase/diagnostics/preflight_ai_quota_migration_privileges.sql`（初回適用前のみ。既存の `ai_quota_owner` / `ai_quota_backend` は不足。成功も `rolcreaterole` 単体も `CREATE WITH GRANT OPTION` も適用可否の証明ではない。読み取り専用チェックは、owner への一時的なデータベース `CREATE` 付与を完全には証明できない） |
| 本番読み取り専用 | `supabase/diagnostics/verify_s1_06_ai_quota_integrity.sql` |
| 隔離 SQL テスト | `scripts/run-ai-quota-sql-tests.sh`（使い捨て PostgreSQL の `AI_QUOTA_TEST_DATABASE_URL`）。integrity確認後、テスト接続のADMIN権限でownerへのSET/INHERITを一時付与し、終了時に取り消す（`enable_disposable_owner_access.sql` / `revoke_disposable_owner_access.sql`）。これはテスト専用で、本番では実行しない |
| 並行プローブ | `supabase/tests/ai_quota/test_concurrent_claim.sh`（実 Postgres 上の簡易試験。一般同時実行の証明ではない） |

SQLテストは既存の開発Supabaseをresetしない。`CREATE ROLE` はデータベース単位でなくクラスタ全体に作用するため、新しい使い捨てPostgreSQLクラスタを起動し、その中に空の `ai_quota_test` databaseを作って実行する。既存クラスタに `ai_quota_owner` / `ai_quota_backend` が残っていれば runner は開始前に拒否する。`AI_QUOTA_TEST_ALLOW_DISPOSABLE_DB=YES` とloopback上の `ai_quota_test` を指す `AI_QUOTA_TEST_DATABASE_URL` を明示する。
