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

GitHub Settingsの読み取り専用確認では、Environmentが存在し`main`限定、Environment secret `MIGRATION_READER_PASSWORD` が登録済み。2変数はEnvironment scopeではなくrepository scopeで登録されている。値は表示せず形式だけ確認した。DB接続、資格情報の有効性、Production identityはworkflowを実行していないため未確認。この作業ではEnvironment・Secrets・Variablesの変更を行っていない。

## Migration管理と残作業

shared-supabase-dbが共有DBのmigration inventoryと履歴の正本であり、Dev/Prod Writerを集約する方針。receipt-managerの通常deploy apply jobと、以前の手動Reader bootstrap workflowは撤去済み。本リポジトリのworkflowから本番migrationを適用できない。既存の`production-db-apply` Environmentおよび`MIGRATION_SUPABASE_DB_PASSWORD` secret設定は削除・変更していないが、receipt-manager workflowからは参照しない。

shared Production WriterはEnvironment準備と実適用検証が完了しておらず、有効化していない。Reader bootstrap migration `20261027150000_migration_preflight_reader.sql` が未適用、またはReader login未設定の場合、通常デプロイはReader gateで停止する。shared側のProduction Writer Environmentをmain限定・承認付きで準備し、shared inventoryに基づく隔離検証と承認済みの本番適用手順を確認してから、必要なbootstrapとReader資格情報を整える。適用・Environment変更はこの作業では行わない。

shared Production Writerへの正式移管には、少なくとも以下の手動作業が残る。

- shared-supabase-dbのProduction Writer Environment、branch restriction、reviewer、資格情報の準備
- Reader bootstrap migrationとProd Reader login/secret設定状態の確認
- shared側での隔離適用検証、および明示的に承認された本番適用検証
- shared Writerの状態・責務を確認した後、旧`production-db-apply` Environment/secretの削除判断

旧writer secretは切替確認前に削除しない。資格情報の値をworkflow、コマンド、ログ、tracked fileへ出さない。

## 運用境界

- PR CIは隔離テストだけを使い、hosted Dev/Prod DBへ接続しない
- 本番deploy workflowはDBを読み取り専用で検査し、migration・DB書き込みを行わない
- receipt-manager側の旧Production履歴checkerとDB URL writer helperは削除済み。既存の隔離Reader権限テストはhosted DBに接続しない
- 既存migrationを編集・削除・renameせず、将来migrationが必要な場合はshared-supabase-db側の明示承認済み作業として扱う
