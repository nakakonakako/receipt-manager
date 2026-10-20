# price-memo Private Broadcast 通知

最終更新: 2026-10-18

この文書は共有Supabase DBからprice-memoへ送る変更通知のDB契約を定める。price-memoの購読・再取得実装はprice-memoリポジトリで管理する。

## 1. 目的と境界

`price_folders`、`price_records`、`price_memo_items`、`price_stores` の変更を、データ本体を含めずに該当ユーザーの端末へ知らせる。通知は無効化の合図であり、正本は既存のRLS付きAPIから再取得したデータとする。

- DBマイグレーションの管理元はreceipt-managerのみ
- 対象4表以外にprice-memo通知triggerを設置しない
- レシート表、Auth、既存RLS、`rename_price_store`、`reorder_price_memo_items`、データ削除RPCの仕様を変更しない
- 同時編集CAS、通知の永続再生、オフライン同期は提供しない
- Broadcastが欠落または購読されていない間の回復はprice-memoのresume同期等に委ねる

## 2. topicとイベント契約

| 項目 | 値 |
|------|----|
| topic | `price-memo:user:<小文字のUUID>` |
| Broadcast event | `price-memo-change` |
| private | `true` |
| payload | `{"table":"<対象表>","operation":"INSERT\|UPDATE\|DELETE"}` |

payloadには行データ、価格、数量、店舗名、メモ、ユーザーID、行IDを含めない。受信側はイベントだけをまとめ、既存APIで必要な一覧を再取得する。イベントの件数・順序は状態の正本として使わない。

## 3. 認可

`realtime.messages` のRLSは既存の有効状態を維持し、次の性質を持つSELECTポリシーだけを追加する。

- roleは`authenticated`のみ
- `extension = 'broadcast'` のメッセージのみ
- `realtime.topic()` が `price-memo:user:` と `auth.uid()` の完全一致であること
- INSERT/UPDATE/DELETEポリシー、クライアント送信権限は追加しない
- migration適用前に既存ポリシーがないことを確認し、未知のポリシーがあればfail closed
- プロジェクト全体のAllow public access設定は変更しない

Privateチャンネルへの購読とDB送信のprivateフラグは両方trueでなければならない。同名topicでもpublic channelとprivate channelは別扱いで、private送信はprivate購読へだけ配信される。Public accessが有効なプロジェクトでも、price-memoのtopicはprivateとして送信し、認可ポリシーで本人以外を拒否する。ただし全プロジェクトで公開チャンネルを禁止する設定にはならないため、プロジェクト共通のprivate-only要件は別途扱う。

## 4. trigger動作

4表の各行にAFTER INSERT/UPDATE/DELETE triggerを1つ設置する。INSERTは`NEW.user_id`、DELETEは`OLD.user_id`、通常のUPDATEは同じ所有者へ1通知を送る。UPDATEで所有者が変わる場合は旧・新両topicへ通知し、それぞれの再取得で消失と追加を反映する。

フォルダ削除のFK CASCADEでは子表のDELETE triggerも発火する。`delete_my_price_memo_data()` は本人の行ごとの通知を生成するため、大量削除では行数に応じてメッセージが増える。重複イベントはクライアント側のdebounceした再取得で吸収する。通知triggerは既存RPCや削除手順を変更しない。

trigger関数は`SECURITY DEFINER`、所有者`postgres`、空の`search_path`とし、参照はスキーマ修飾する。動的SQL・利用者指定のtopic・公開RPCを使わず、関数EXECUTEをPUBLIC、anon、authenticated、service_roleから剥奪する。

`realtime.send()`に失敗した場合はSQLSTATEだけを警告ログに残し、例外を捕捉して元のDMLを継続する。通知はベストエフォートであり、トランザクション自体がrollbackされた変更は通知されない。切断・通知欠落への再同期はprice-memo側の責務。

## 5. 適用・ロールバック

このマイグレーションを含むPRのmainマージは既存CDから本番migrationを自動適用する。PR段階では適用しない。本番適用前に、既存`realtime.messages`ポリシー、Realtime公開設定、`realtime.send`の署名・実行権限、対象表・RPCの本番定義、隔離SQLテストの結果を再確認する。

適用後に通知を止める場合は、共有DB管理手順として4表の`price_memo_broadcast_invalidation` triggerを削除し、`public.broadcast_price_memo_invalidation()`関数と本ポリシーを削除する。これはデータを変更しないが、price-memoのリアルタイム無効化を停止する。履歴を書き換えず、必要なら新しいforward migrationで行う。

## 6. 検証

`scripts/run-price-memo-private-broadcast-sql-tests.sh` は、専用名の新規loopback PostgreSQL DBだけを許可する。テスト用の`realtime.send()`実装はローカルDB内にBroadcast行を記録し、RLSによるtopic分離、未認証受信拒否、クライアントINSERT拒否、4表のDML、所有者変更、CASCADE、一括削除、send失敗時のDML継続、transaction rollbackを検証する。

この隔離SQLテストはPostgreSQLポリシーとtriggerの検証であり、Supabase Realtimeサーバーへの実WebSocket購読を検証するものではない。本番反映前にprice-memoクライアントとのprivate channel統合確認を別途行う。
