# receipt-manager DB統合テスト対象

`receipt-manager.json`はshared-supabase-db DB contract v1のカタログ検査条件を宣言する。以下はv1で保証できないか、静的catalog検査だけでは実動作を証明できないため、使い捨てPostgreSQL 17 / Supabase互換環境で別途検証する。

## publicスキーマ

- RLS policy名・command・role・`USING` / `WITH CHECK`式。現行migrationのpolicy名は大文字・空白を含み、v1の小文字識別子形式に適合しない。現行metadataは`receipts`/`receipt_items`/`csv_transactions`の`Users can ... own ...` policy群（`PUBLIC`対象）と、`chat_messages`/`csv_presets`の`Enable ALL operations for users based on user_id`（`authenticated`対象）。v1拡張後にpolicy metadataを契約化する
- `chat_messages_role_check`などのCHECK制約式。契約v1はcheck constraintを宣言できず、chat role値が`user` / `assistant`で制限されることを契約本文で保証できない
- Auth/JWT claim下で各public tableのSELECT / INSERT / UPDATE / DELETEを実行し、本人の行のみ許可し別ユーザーの行を拒否すること。特に`PUBLIC`対象policyが未認証ユーザーへ行を許可しないこと
- `receipt_items`から`receipts`へのPostgREST relationship/join解決と、複合FK `(user_id, receipt_id)` / `(user_id, id)`の同一所有者制約
- セッションJWTで作られるbackend Supabase clientがRLSに従い、receipt/CSVの登録・編集・削除・検索で期待する行だけを操作すること

## AI quota

- `ai_quota_backend`のTLS接続、role LOGIN属性、パスワード/TLS CA設定、pool開閉、query timeoutおよび失敗時閉鎖。backendは`backend/app/services/ai_quota_db.py`の3つの固定SQLだけを`psycopg`で実行し、PostgRESTを使わない
- RPC実動作: `claim_ai_request`のgranted/rejected/idempotent、user/global daily limits、同時実行・緊急停止・monthly cap・unknown usage breaker、request idempotency
- `renew_ai_lease`のactive/expiry判定、`finish_ai_request`のusage有無・token/cost精算・finish conflictと再試行
- 並行claimの直列化と単一grant、DB例外/DB未設定時のfail-closed、AI quota障害がAI以外のAPIを停止しないこと
- `settings` singletonとdefaults/check constraints、`requests`状態とtoken/usage shape、未知利用部分indexとそのpredicate。既存の`supabase/tests/ai_quota/`隔離SQL suiteを継続し、使い捨てクラスタだけで実行する

## v1と既存診断の保証範囲

契約v1で検査できるもの:

- 宣言した必須テーブルのrelkind、必須カラムの型/NULL許可、PK/UNIQUE/FKの列・参照・ON DELETE・validated状態
- RLS enabled/forced flags、ACLの対応するtable privileges（relation単位）
- RPCの正確な入力/出力引数名・順序・mode・型、`record`戻り型とSETOF、SECURITY DEFINER/INVOKER、`search_path`、EXECUTE role
- 追加テーブル/カラムの存在は互換性違反にしない

既存`supabase/diagnostics/verify_s1_06_ai_quota_integrity.sql`は契約より広い別の読み取り専用ゲートとして維持する。これはmigration履歴、`ai_quota` schema/table/functionのowner、roleの属性、membershipのSET/INHERIT、`ai_quota_owner`のdatabase CREATE、schema USAGE、table privileges、RPC SECURITY DEFINER/空search_path/owner/EXECUTE、settings singleton実在、設定default、特定column、index predicate、constraint式の一部、helper function実在を検査する。singleton確認では`ai_quota.settings`の1行を読むため、catalog-only契約検査とは扱いを分ける。

v1では以下を契約として検証できない。検証済みの代替条件として扱わず、上記の既存diagnosticまたは隔離統合テストを維持する。

- role属性（LOGIN/NOLOGIN、SUPERUSER等）、role membershipとADMIN/SET/INHERIT option、function/table/schema ownership、database-level CREATE権限
- `ai_quota` schema USAGE ACL、role password/TLS/connection設定、`pg_default_acl`、schema/table/function owner/default-privilegeの厳密な保証
- PostgreSQL 17 `MAINTAIN` privilege（v1 privilege enumにない）
- CHECK制約式、column default、partial index定義/predicate、settingsのsingleton行や値
- AI quota helper function群・function body・戻りデータの意味、競合/transaction動作
- RLS policy式、実際のAuthユーザー間分離、実行結果、例外時rollback

## 根拠

- Supabase JSの直接アクセス: `frontend/src/features/search/components/ChatInterface.tsx`（`chat_messages`）、`frontend/src/features/csv/hooks/useCsvUploader.ts`（`csv_presets`）
- Supabase Python clientのCRUD / select / join: `backend/app/services/supabase_service.py`
- 要確認の型注釈不一致: `backend/app/main.py`のDELETE path parameterはUUID文字列を受ける一方、`supabase_service.py`の`delete_receipt` / `delete_csv_transaction`は`int`注釈。DB列はmigration上uuidで、今回はアプリコードを変更せず契約もuuidとして宣言
- AI quota接続・許可RPC・bind parameter SQL: `backend/app/services/ai_quota_db.py`; configは`backend/app/services/ai_quota_config.py`
- public table columns / 初期RLS / Auth FK / ACL: `supabase/migrations/20260824183225_remote_schema.sql`
- receipt itemの旧column削除: `supabase/migrations/20260825100000_remove_memo_and_is_comparable.sql`
- receipt owner composite FK / unique: `supabase/migrations/20261009010000_owner_composite_foreign_keys.sql`
- public table over-privilege revoke: `supabase/migrations/20261015120000_s1_f01_revoke_excess_table_privileges.sql`; read-only check: `supabase/diagnostics/verify_s1_f01_acl_integrity.sql`
- AI quota schema, tables, RPCs, grants: `supabase/migrations/20261014120000_s1_06_ai_quota_foundation.sql`; read-only check: `supabase/diagnostics/verify_s1_06_ai_quota_integrity.sql`; isolated SQL: `supabase/tests/ai_quota/`
- App-level quota orchestration and actual endpoint use: `backend/app/services/ai_quota_guard.py`, `backend/app/main.py`

契約形式検証にはshared-supabase-db main commit `e61b5ff83539dca53cf21c8321f507480dea248c`の検証器を固定SHAで使用する。形式検証のみであり、DB接続やcatalog verificationの結果ではない。
