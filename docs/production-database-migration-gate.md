# 本番DB Reader gate

## 通常の本番デプロイ

`.github/workflows/deploy.yml` は `main` push と `workflow_dispatch` で起動し、次の全条件を満たした場合だけbuild・VPS deployへ進む。

1. `quality` の `npm run check` が成功
2. `production-db-check` Environment内で、固定SHA `c06454f78cc3db27964829fd0e357cbb0d3536f8` の `consumer-production-db-check` actionが成功
3. RPC・AI quota・ACL integrityの既存診断がすべて`PASS`

shared actionは、Production DB identity、shared-supabase-dbのmigration inventory/historyが`IN_SYNC`であること、対象receipt-manager commitのDB契約が`STATIC PASS`であることを確認する。`PENDING`、`REMOTE_ONLY`、契約不一致、接続・実行エラーはdeployを停止する。receipt-managerの`supabase/migrations/`をDB全体のmigration履歴として使わず、本番migrationの自動適用もしない。

`integrity` jobは `verify_s1_08_rpc_integrity.sql`、`verify_s1_06_ai_quota_integrity.sql`、`verify_s1_f01_acl_integrity.sql` を実行する。検証不一致は`MISMATCH`として区別されるが、workflowは`PASS`以外をbuild/deployへ通さない。接続やSQL実行エラーも失敗する。

同jobでは `verify_production_db_reader.sql` と `verify_migration_reader_bootstrap.sql` もReader接続で実行する。これらはReader loginの実効権限、最小権限role属性、Reader roleの狭いGRANT、`postgres` の`ai_quota_owner` ADMIN-only membershipを監査する。共通actionのDB identity・共有migration履歴・アプリ契約検証では保証されないため、両SQLの失敗もbuild/deployを停止する。

全jobとdeployは`receipt-manager-production-db` concurrency queueを共有し、実行中runをcancelしない。各段階で最新main SHAを再確認する。

## `production-db-check` Environment

Environmentは事前に作成し、deployment branchを`main`のみに制限する。workflowが読む変数とsecretは次のとおり。

- Variable `PROD_SUPABASE_POOLER_HOST`（Environment scope推奨）
- Variable `PROD_SUPABASE_PROJECT_REF`（Environment scope推奨）
- Secret `MIGRATION_READER_PASSWORD`

Reader usernameは`migration_preflight_login.<project-ref>`。loginはshared-supabase-dbが管理するReader roleだけを継承し、Production DB identityと読み取り専用権限の検証を通す必要がある。workflow実行時にEnvironmentから値が渡らなければfail closedとなる。

GitHub Settingsの読み取り専用確認では、`production-db-check` が存在し`main`限定、Environment secret `MIGRATION_READER_PASSWORD` が登録済み。`PROD_SUPABASE_POOLER_HOST` と `PROD_SUPABASE_PROJECT_REF` はEnvironment scopeではなくrepository scopeで登録されている。値は表示しない。Dev/ProdのReader検証と、Writer資格情報のread-only接続・identity probeは成功済み。read-only成功はPENDING migrationの実適用を証明しない。この文書の更新ではEnvironment・Secrets・Variablesを変更しない。

## Migration管理と現在の状態

shared-supabase-dbがhosted migration inventoryとDev/Prod Writer適用を所有する。receipt-managerの旧Production apply workflowと、以前の手動Reader bootstrap workflowは撤去済み。本リポジトリのworkflowから本番migrationを適用できない。`npm run db:push` は停止しており、環境準備、パスワード入力、Supabase CLI呼び出しの前に終了する。アプリdeployは固定SHAのshared Reader gateと読み取り専用integrityだけを実行し、migrationを適用しない。

shared-supabase-db `a22807e`（2026-10-31確認）時点の運用状態は次のとおり。

- Dev/Prod Reader検証と、Writer資格情報のread-only接続・identity probeは成功済み
- sharedの `development-db-apply` と `production-db-apply` はmain限定、Required reviewers、administrator bypass無効を読み取り確認済み
- `DEV_DB_WRITER_ENABLED=false`、`PROD_DB_WRITER_ENABLED=false`。flagがfalseの間、shared WriterはPENDINGを適用しない
- Dev migration historyは `IN_SYNC`
- Dev/Prodのshared WriterによるPENDING migration実適用は未検証。Devの `IN_SYNC` no-op成功は適用能力の証拠にならない
- Prodへの実適用は別途の明示承認が必要
- Dev DB passwordはローテーション済みで、旧ローカルWriter passwordは削除済み

Reader loginやReader bootstrapの読み取り検証が失敗した場合、通常デプロイはReader gateまたはintegrityで停止する。適用、Environment、Secret、Variableの変更はこの文書更新では行わない。hosted migrationの追加と適用手順の正本は [shared-supabase-dbのMigration Writer運用手順](https://github.com/nakakonakako/shared-supabase-db/blob/a22807e/docs/migration-writer-handoff.md)。

## 旧Production Writer Secretの保持

receipt-managerに残る `production-db-apply` Environmentと `MIGRATION_SUPABASE_DB_PASSWORD` は未削除で、このリポジトリのworkflowからは参照しない。これはshared-supabase-db側の `production-db-apply` とは別の設定である。

次がすべて完了するまで、receipt-managerの旧Production Writer Secretを削除しない。

- shared ProductionのPENDING migration実適用
- そのReader postflight
- receipt-managerとprice-memoのDB互換性確認と本番配信成功
- receipt-managerおよびsharedのworkflowに旧Writer参照経路がないことの再監査

監査後も削除には別途承認が必要。初回のshared Production実適用より前には削除しない。資格情報の値をworkflow、コマンド、ログ、tracked fileへ出さない。`db:push` の停止は、このSecretの削除やProduction passwordのローテーションを意味しない。

## 運用境界

- PR CIは隔離テストだけを使い、hosted Dev/Prod DBへ接続しない
- 本番deploy workflowはDBを読み取り専用で検査し、migration・DB書き込みを行わない
- receipt-manager側の旧Production履歴checkerとDB URL writer helperは削除済み。既存の隔離Reader権限テストはhosted DBに接続しない
- 既存migrationを編集・削除・renameせず、将来migrationが必要な場合はshared-supabase-db側の明示承認済み作業として扱う
