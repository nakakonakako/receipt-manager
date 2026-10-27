# 本番DB migration gate

この手順は `production-db-check` と `production-db-apply` のGitHub
Environmentsを準備し、全mainデプロイでDB状態を確認してからアプリを出荷する。
workflowをmainへ入れる前にSettingsを準備する。Environmentが存在しない場合、GitHubが
保護設定なしで作成する可能性があるため、workflowだけを先にmergeしてはならない。

## Environmentとcredential

1. `production-db-check` Environmentを作成し、deployment branchを `main` のみに制限する。
   Required reviewersは設定しない。repository variablesとして
   `PROD_SUPABASE_POOLER_HOST` と `PROD_SUPABASE_PROJECT_REF` を設定する。reader LOGINは
   bootstrap後に作成するため、この時点では `MIGRATION_READER_PASSWORD` を設定しない。
   secret未設定のpreflightはfail closedでdeployを停止する。
2. `production-db-apply` Environmentを作成し、deployment branchを `main` のみに制限する。
   Required reviewersに本人を登録し、Prevent self-reviewを無効、administrator bypassを
   無効にする。Environment secretに `MIGRATION_SUPABASE_DB_PASSWORD` を設定する。Supabase Management API tokenは使わず、
   CLIの `db push --db-url` でPostgresへ直接接続する。
3. Environment secret名は既存repository/org secretsとは別名にする。同じ名前のrepository
   secretを作らず、workflowから旧 `SUPABASE_ACCESS_TOKEN`, `PROD_SUPABASE_DB_PASSWORD`,
   `PROD_SUPABASE_PROJECT_ID` を参照しない。既存値は切替完了まで保持する。
4. `production-db-check` loginは `migration_preflight_reader` のみを継承し、
   `default_transaction_read_only=on`、no superuser/createdb/createrole/replication/bypassrls、
   接続・statement timeoutを設定する。login roleのpasswordはreader Environmentにのみ置く。

reader group roleはPR #35のmigrationが作成する。bootstrap後に管理者が専用LOGINを作成し、
`GRANT migration_preflight_reader TO migration_preflight_login WITH INHERIT TRUE, SET FALSE`
相当のmembershipを設定する。`verify_production_db_reader.sql` で公開業務テーブル、AI利用値、
SECURITY DEFINER実行権限へのアクセスがないことを確認してからreader secretを有効化する。
role password設定時は対話型 `\password` 等を使い、SQLやActionsログに値を残さない。

## 導入順序と初回bootstrap

1. 上記Environments、branch制限、reviewer、secret names、variablesを人手で確認する。
   既存repository writer secretsはまだ削除しない。
2. 段階2 workflow PRをmainへ取り込む。readerが未設定なら最初のpushはpreflightで失敗し、
   build/deployへ進まない。これは意図した停止状態。
3. PR #35を取り込む。通常deployはreader未準備なら同様に失敗する。自動的にwriterへ
   fallbackしたり、migrationを適用したりしない。
4. `Bootstrap production DB reader` workflowをmainから手動実行し、入力に
   `bootstrap-reader-20261027150000` を指定する。`production-db-apply` Environmentの本人承認後、
   workflowが最新main SHA、migration履歴、対象version、`ai_quota_owner` ADMIN権限と
   SET/INHERIT無効状態を確認する。RPC/ACLの明示的なassertion mismatchだけは記録してreader
   bootstrapへ進める。接続・権限・SQL実行エラーは停止する。対象migrationだけが未適用の場合のみapplyし、
   適用後に履歴、reader group role、ADMIN-only owner membershipを再検証する。残るRPC/ACL mismatchは
   明示して通常の承認付きforward migrationへ引き継ぐ。このworkflowはアプリをbuild/deployしない。
5. bootstrap migrationは `ai_quota_owner` のADMIN OPTIONが残ることを検証し、必要な列
   (`settings.id`) のみ付与する。SET/INHERITは一時的に変更し、終了後に無効であることを
   確認する。`verify_migration_reader_bootstrap.sql` はbootstrap後と毎回のpreflight/postflightで
   postgresのADMIN保持とSET/INHERIT無効を確認する。残るRPC/ACL mismatchがあれば通常deployは停止し、
   readerが有効になった後、PENDINGのforward migrationをEnvironment承認付きで適用して修復する。
6. 本番DB管理者が対話型 `psql` で `migration_preflight_login` を作成し、`\password`
   でpasswordを設定する。`migration_preflight_reader` だけを `INHERIT TRUE, SET FALSE`
   で付与し、`default_transaction_read_only=on`、`statement_timeout=15s`、`lock_timeout=3s`
   を設定する。Supabase shared poolerのusernameは `migration_preflight_login.<project-ref>`。
   値をログに出さず `production-db-check` の `MIGRATION_READER_PASSWORD` に設定し、readerで
   `verify_production_db_reader.sql` を実行してから次へ進む。
7. `CI/CD Pipeline` を最新mainから `workflow_dispatch` する。reader接続、履歴一致、reader権限、
   RPC/ACLがすべて成功した場合だけbuild/deployへ進む。失敗した場合はDB状態とroleを修正し、
   最新main SHAで再実行する。
8. 本番DB writer credentialが `production-db-apply` Environmentだけで使われ、main上の自動
   デプロイが成功した後に限り、旧repositoryの `SUPABASE_ACCESS_TOKEN`,
   `PROD_SUPABASE_DB_PASSWORD`, `PROD_SUPABASE_PROJECT_ID` を削除できる。writer passwordを
   Environmentへ移行した後もworkflow全件で旧secret参照がないことを確認してから削除する。

## 日常運用と失敗復旧

- 全main pushは固定concurrency queueに入り、readerでmigration履歴とreader権限を検査する。
  履歴一致ならRPC/ACL検査も必須で、成功時はwriter承認なしでdeployする。
- 未適用migrationがある場合、適用前RPC/ACL検査の明確なassertion mismatchは、修復migration用の
  承認付きapply経路を妨げない。接続・SQL実行・権限・timeoutのエラーはmismatchと区別して停止する。
  apply後は完全なRPC/ACL postflightを必須とし、失敗時はbuild/deployしない。
- 履歴が未適用なら `production-db-apply` の本人承認を要求する。承認拒否・未承認・apply失敗・
  postflight失敗ではbuild/deployは実行されない。後続のコードだけのpushも毎回DBを再検査するため、
  pendingまたは検証失敗が残る限り停止する。
- remote-only、形式不正、接続失敗、migration削除/変更、reader検証失敗はfail closed。
  migration失敗時は原因を確認し、適用済みmigrationを編集・削除せず、新しいforward-fixを追加する。
  PENDING時のRPC/ACL assertion mismatchを許可するのはEnvironment承認後のapplyに限り、
  apply後の検証成功なしにアプリをbuild/deployしない。
  部分適用が疑われる場合はDB履歴と診断結果を人が確認し、手動DB変更でworkflowを迂回しない。
- 同時runは `receipt-manager-production-db` queueで直列化し、実行中runをcancelしない。
  待機中にmainが進んだrunはapply直前およびdeploy直前のremote SHA確認で失敗し、最新runを使う。
  Git ref確認とDB操作は原子的ではないため、ごく短いref更新競合は残る。適用後・deploy前にも
  最新SHA確認し、古いimageを出荷しない。
- GitHubの`queue: max`は待機数上限がある。上限超過でrunがcancelされた場合は、最新mainのrunを
  手動dispatchする。queue外の手動DB操作は直列化されないため、承認付きworkflow以外から本番
  migrationを実行しない。
- 永続的な失敗markerは使わない。各pushで実DBの履歴と診断を再評価し、未適用・不整合が実DBに
  残れば後続runも失敗するためである。DB状態が正常化した後は最新main runで復旧できる。

## 運用上の境界

- 通常deployのreader資格情報はread-only、writer資格情報は `production-db-apply` Environment
  内だけに置く。migrationなしのpushでもreader secret/roleが必要であり、未設定ならdeployしない。
- PR checksは隔離DB/モックのみで、本番または共有開発DBへ接続しない。
- migration履歴の照合はmigration versionを比較する。適用済みSQL本文やDB schema driftを
  cryptographic hashで証明するものではない。
- `workflow_dispatch` はmain refだけを許可するが、Environmentのmain branch restrictionも併用する。
- 将来migration管理を別repositoryへ移す場合、reader/app deploy gateはreceipt-managerに残し、
  writer Environmentと直列化されたapply workflowを移管する。移行中に二つのwriter経路を並行稼働させない。
