# 本番migrationの段階的な承認・整合性ゲート

## 現在の段階

この文書とコードは段階1の準備物です。既存の本番deploy workflow、GitHub Settings、Environment、Secrets、DBには変更を加えていません。`20261027150000_migration_preflight_reader.sql` は本番DBには未適用です。

このPRに含まれるmigrationを現行mainへ先にマージすると、現在のdeploy workflowが承認なしで本番へ自動適用する可能性があります。段階2のEnvironmentゲートがmainで有効になるまで、このPRをマージしないでください。

## 履歴チェッカー

`scripts/check-migration-history.py` はローカルの `supabase/migrations/*.sql` の14桁versionと、接続先の `supabase_migrations.schema_migrations.version` を比較します。接続は `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSLMODE` 等のlibpq環境変数から受け取り、引数・標準出力へ資格情報やDBエラー本文を出しません。

- `IN_SYNC`: 完全一致。exit 0
- `PENDING`: ローカルのみ。migrationを含むこのpushで承認付き適用する場合以外はdeployを止める。exit 1
- `REMOTE_ONLY`: DBにだけ履歴がある。自動修復せず必ず停止。exit 1
- `ERROR`: 接続不能、形式不正、version重複、migration名不正など。停止。exit 2

`--base-ref <sha>` はそのrefから既存migrationの変更・削除・renameを拒否します。追加だけを許可します。比較対象refはCIでpushイベントの直前SHAとし、shallow cloneではなく履歴を取得します。履歴version比較はmigration本文のhashやDB schema driftを証明しません。

## 読み取りロール

`migration_preflight_reader` は `NOLOGIN` の権限グループです。migrationは `postgres` DBへのCONNECT、`supabase_migrations` schemaのUSAGE、`schema_migrations.version` 列、`ai_quota.settings.id` 列だけのSELECTを付与します。`id` は設定値を読まずにsingleton行の存在だけを数えるためです。migration executorには既存のADMIN-only membershipが1件だけ存在することを事前確認します。トランザクション内でexecutor自身が一時membershipを追加してSETし、この列権限だけを付与します。その後、一時membershipだけを `GRANTED BY current_user` で取り消すか、既存membershipのSETを無効に戻します。元のADMIN-only membershipは維持し、復元workflowには依存しません。アプリ業務テーブル、migration本文列、AI quotaの設定値・request行へのSELECT、書込み権限、アプリrole membershipは付与しません。`pg_catalog` の通常の公開カタログ情報は診断SQLに必要です。

認証用LOGIN roleはこのmigrationでは作りません。後述の初回bootstrap後に、別の非特権LOGINを作成してこの権限roleだけを付与します。Environment secretに保存するreaderパスワードは本番DB管理者が設定し、migrationファイルや通常のrepository secretには置きません。

`verify_migration_preflight_reader.sql` は接続ユーザーの属性、所属role、publicテーブルのSELECT権限、persistent DDL権限、`public` / `ai_quota` の実行可能な SECURITY DEFINER 関数を検査します。発見時はfail closedです。セキュリティ判定は実DB上の実ロールで行う必要があり、このチェックはPostgreSQL/Supabase内部の全拡張スキーマに対する完全な攻撃面証明ではありません。

既存の `verify_s1_f01_acl_integrity.sql` と `verify_s1_06_ai_quota_integrity.sql` は検証者が `postgres` であることに依存しないよう変更しました。AI quota verifierは `settings.id = 1` の行数だけを数え、値は読みません。RPC/ACL verifierの全体実行はSupabase互換の隔離DBで検証してください。本段階の使い捨てPostgresテストはreaderの権限とrole verifierを検証し、Supabase固有の全RPC依存までは再現しません。

## 段階2以降の本番切替順序

順序を入れ替えるとGitHubが保護設定のないEnvironmentをworkflow参照時に自動作成するおそれがあります。

1. **GitHub Environmentを先に作成**: `production-database` を作り、deployment branchを `main` に制限します。Environment secrets/variablesを使う設定にし、個人開発者が自分のrunを承認できるよう `Prevent self-review` は有効にしません。別の承認者は要求しません。利用プランでEnvironment protection rulesが利用可能であることを確認します。
2. **専用writer secretsを登録**: Environment内に新しい一意名（例 `MIGRATION_SUPABASE_ACCESS_TOKEN`、`MIGRATION_SUPABASE_DB_PASSWORD`、`MIGRATION_SUPABASE_PROJECT_ID`）を登録し、non-emptyをworkflowで確認します。既存のrepository secretsと同名にしません。Environment secretの未定義時に同名repository secretへフォールバックさせないためです。既存repository secretsはまだ削除しません。
3. **ゲートworkflowを先にmainへ導入**: workflowのmigration writer jobだけをEnvironment承認対象にし、通常のコードのみpushは承認待ちにしません。整合性preflightは毎回実行します。Environmentを確認してから、このworkflow変更を含むPRをmergeします。workflowだけのpushでDB接続・migrationが起動しないことを確認します。
4. **排他・最新main検査を有効化**: main向けDB/release workflowに固定concurrency group、`cancel-in-progress: false`、待ち行列上限を設定します。承認後、migration適用直前とimage publish/deploy直前にremote main SHAがrun対象SHAと一致することを確認し、不一致なら停止します。checkoutは常にその承認済みSHAに固定します。独立した本番DB writer経路をなくします。
5. **migrationを含む変更を承認付きで適用**: migration差分があり、履歴がlocal-onlyだけのときのみEnvironment承認後にwriter jobを動かします。完了後にreaderが再接続して履歴一致を確認し、RPC/ACL verifierを実行します。どれか失敗したらbuild/deployを開始しません。
6. **reader LOGINを安全にbootstrap**: migration適用後、本番DB管理者が信頼された対話型 `psql` で `CREATE ROLE migration_preflight_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;` を実行し、直後に `\password migration_preflight_login` でエコーなしにpasswordを設定します。続けて `GRANT migration_preflight_reader TO migration_preflight_login WITH INHERIT TRUE, SET FALSE;`、`ALTER ROLE migration_preflight_login SET default_transaction_read_only = on;`、`ALTER ROLE migration_preflight_login SET statement_timeout = '15s';`、`ALTER ROLE migration_preflight_login SET lock_timeout = '3s';` を設定します。LOGINには `anon`、`authenticated`、`service_role`、`postgres` や他の権限roleを付与しません。
7. **reader secret設定後にpreflightを必須化**: Environmentにreader用の一意なusername/passwordとreader用接続先を登録します。値は表示・ログ出力せず、readerで `verify_migration_preflight_reader.sql` と履歴チェッカー・RPC/ACL診断を実行します。成功してから全main pushでpreflightを必須化します。未適用、remote-only、DB接続不能、診断失敗はすべて後続のコードのみpushも停止させます。
8. **旧writer secretsを削除**: 旧repository secretsが他workflow、手動workflow、repo内外のwriter経路で参照されず、Environment経由の承認付きwriterだけが残り、reader-only workflowがwriter credentialsを一切受け取らないことをGitHub workflow全件で確認した後に限り削除します。

### push順序・失敗の扱い

すべてのmain pushで整合性preflightとDB検証の状態を評価し、migrationのGit差分だけで成功扱いにしません。local-onlyがあるのに当該pushにmigration追加がなければ失敗です。remote-only、履歴不正、接続失敗、前回のRPC/ACL検証失敗が残っている状態ではコードだけのpushも停止します。migration適用後に診断だけ失敗した場合、履歴が一致していても失敗状態を次runへ保持する機構（永続gate stateまたは検証済みGitHub run state）を段階2の実装で用意し、writer承認付きの修復runと再検証が成功するまで解除しません。

同時runは単一concurrency groupでmigrationからdeploy完了まで直列化します。GitHub Actionsの排他はGit ref更新自体をロックしません。SHAの直前確認とdeploy直前確認でstale runを停止できますが、最後の確認からDB操作までにmainが更新されるraceを数学的に排除できるわけではありません。より強い保証が必要なら、運用中のmain更新凍結やDB適用専用の保護されたrelease refが必要です。

### 復旧

- DB接続失敗: secrets・ホスト・TLS・接続枠を値を出さずに管理者が確認。workflowを再実行する前に、最新main SHAの一致と他runの終了を確認
- local-only: 承認付きwriter runで適用できるmigrationかレビュー。適用失敗なら状態を残し、原因修正をforward migrationとして追加
- remote-only/不正履歴: 自動repairや `schema_migrations` の手編集をしない。Supabase管理者が実履歴を照合し、承認された復旧計画を作成
- migration適用済み・RPC/ACL失敗: migrationを書き換えたり履歴を削除したりせず、forward-fixとverifier修正をPRで用意し、承認付き適用後に全検証
- ゲート導入途中: fail closedの間はdeployを止める。既存repository writer secretは復旧手段と誤解せず、workflowに戻さない。新Environment・secret・workflowの順序を完成してから再実行

## 検証

- 純粋ロジック: `python3 scripts/test_migration_history.py`
- 使い捨てPostgreSQL: `bash scripts/test-migration-preflight-reader.sh`。一意名の一時Postgresコンテナのみを起動し、終了時にそのコンテナを停止する。共有DBやSupabaseへ接続しない
- 標準CI: `npm run check` に上記2テストを含める

migration version比較はファイルhash、実DBのschema drift、Supabase API/extensionの全権限を証明しません。実際のreader credential検証、GitHub Environment承認、並列workflowの挙動は段階2で隔離したGitHub環境に相当する仕組みを用いて別途確認します。
