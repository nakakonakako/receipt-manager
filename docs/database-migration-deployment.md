# 本番DB migration readerの実装メモ

本番migration gateのEnvironment設定、bootstrap、日常運用、復旧の手順は
[production-database-migration-gate.md](./production-database-migration-gate.md)を正本とする。
段階2 workflowはmainに導入済み。reader secretが未設定の間、main pushはpreflightで停止する。
PR #35のreader role migrationは未適用で、通常deployが承認なしにwriterへfallbackすることはない。

## Migration履歴

`scripts/check-migration-history.py` はローカルmigration versionと
`supabase_migrations.schema_migrations.version` を比較し、`--base-ref` に対する既存migrationの変更・削除も拒否する。
checker単体の `PENDING` は状態を呼び出し元に返すため終了コード0だが、deployのapply routingとpostflightが状態値を別途検査する。
postflightは `IN_SYNC` のみ成功し、`PENDING`、`REMOTE_ONLY`、`ERROR` はbuild/deployを停止する。
履歴versionの一致はSQL本文hashやschema driftを証明しない。

## Reader権限

`20261027150000_migration_preflight_reader.sql` は `migration_preflight_reader` をNOLOGINで作成し、
`postgres` DBへのCONNECT、`supabase_migrations` schemaのUSAGEと
`schema_migrations.version`、`ai_quota.settings.id` 列のSELECTだけを付与する。
設定値、migration本文、業務データ、quota request、書込み権限は付与しない。

適用前にexecutorのADMIN-only `ai_quota_owner` membershipが1件であることを確認する。
migrationは一時的なmembershipを使ってSETし、必要な列権限を付与した後、
自分がgrantorの一時membershipだけを解除する。bootstrap由来のADMIN-only membershipとgrantorを維持し、
後続workflowでの権限復元に依存しない。失敗はmigration transaction全体をrollbackする。

## 検証

- `npm run check`: migration履歴ロジックと通常の品質チェック
- `npm run test:db-migration-reader`: disposable PostgreSQL 17でreader権限、失敗rollback、再実行を検証
- PR CIは隔離PostgreSQLテストを実行。本番・共有開発DBへ接続しない

テスト環境はSupabaseの全managed privilegeを再現しない。本番適用前にはrunbookに記載した読み取り専用diagnosticで、
executorのrole属性と `ai_quota_owner` membershipのgrantor、ADMIN、SET、INHERITを確認する。
