# Cursor委譲monitor共通契約 v2

この文書は、receipt-managerとprice-memoのCodex → Cursor委譲monitorで
共通して保証する外部動作です。共通ライブラリや同一の内部実装は
要求しません。Monitor共通契約v1は両リポジトリで採用済みです。
両リポジトリは独立したMonitor実装とテストを持ち、採用状態はそれぞれのPRで
確認しています。

## 採用記録

- receipt-manager: PR #54、merge commit
  `f7972c98c49d7854ec9371043421dcdd57e0f76f`。GitHub Actions
  [pr-quality](https://github.com/nakakonakako/receipt-manager/actions/runs/41291950769)
  はsuccess。
- price-memo: PR #54、merge commit
  `c0453d2032b016b0fac1d462a9813abe7ffba8f7`。GitHub Actions
  [pr-quality](https://github.com/nakakonakako/price-memo/actions/runs/41293821036)
  はsuccess。

## 契約

| ID | 受け入れ条件 | 正常・異常時の扱い |
|---|---|---|
| MON-01 | Workerプロセスの終了コードと最後に認識したCursor `result` eventの両方を成功判定に使う | 終了コード0、`success` result、エラーでない状態が揃った場合だけ成功。result欠落・エラー・不正な成功状態・非0終了は失敗 |
| MON-02 | `VERIFICATION RESULTS`ブロックから`COVERAGE`と`PASS` / `FAIL` / `UNCONFIRMED`を解析する | Workerの終了成功と検証coverageを別々に示す。不正・欠落・矛盾・切り詰められた検証情報をPASSに推定しない |
| MON-03 | stream-jsonを行単位で上限付き処理する | 不正JSONと未知eventの内容は露出せず安全に無視する。長すぎる行は破棄して次の行から再開し、上限内のEOF終端行は処理する。入力上限を超えた結果を成功根拠にしない |
| MON-04 | 通常進捗の表示量に上限を設ける | 進捗洪水を抑制し、抑制数と最終結果を表示する。終了・失敗・中断・状態保存失敗・verificationなどの重要通知は通常進捗上限で隠さない |
| MON-05 | 内部メッセージ、ツール引数・結果、未加工出力を無制限に表示・保存しない | 既知の秘密パターンとテスト用環境secretを可能な範囲でマスクし、報告と診断情報にサイズ上限を設ける。マスクは網羅的ではないため、残る情報も機密として扱う |
| MON-06 | 同一workspaceの重複実行を排他する | canonical pathで相対パス・symlink aliasによる回避を防ぐ。別workspaceは並行実行可能。正常終了・異常終了・中断後はlockを解放する |
| MON-07 | SIGINT / SIGTERMによる中断を処理する | シグナルは当該monitorが起動したWorkerのprocess groupだけに送り、中断を成功と報告しない。他workspaceのWorkerには作用させない |
| MON-08 | 状態・診断の保存量、権限、保持範囲を制限する | 未加工のWorker出力を無制限に永続化しない。保存先・ファイルの権限を検査し、保存・削除は対象monitorの安全な所有範囲に限る。保存方式はrepoごとに異なってよい |

## receipt-managerでのテスト対応

`npm run check`からbackend unittestと状態保存テストが実行されます。

| 契約 | 対応テスト |
|---|---|
| MON-01 | `backend/tests/test_delegate_cursor_monitor.py`: `test_missing_or_error_result_is_not_success`, `test_success_result_with_nonzero_worker_exit_is_failure`, `test_oversized_unterminated_result_is_counted_and_not_treated_as_success` |
| MON-02 | 同: `test_missing_or_malformed_verification_is_unconfirmed`, `test_input_over_64_kib_is_unconfirmed_even_with_pass_in_prefix`, `test_verification_findings_are_sanitized_before_prioritization`, `test_report_is_absent_from_status_and_diagnostic_logs` |
| MON-03 | 同: `test_bounded_stdout_lines_accept_limit_and_recover_after_oversize`, `test_bounded_stdout_lines_count_unterminated_oversize_and_parse_final_json`, `test_malformed_and_unknown_stream_content_is_not_printed` |
| MON-04 | 同: `test_progress_output_is_bounded_and_final_report_is_not_suppressed`, `test_report_preserves_tool_progress_and_heartbeat`, `test_interrupt_is_forwarded_and_recorded`, `test_sigterm_is_forwarded_and_not_reported_as_success` |
| MON-05 | 同: `test_success_keeps_only_minimal_metadata`, `test_failure_classifies_and_scrubs_bounded_stderr_diagnostics`, `test_report_masks_known_patterns_and_environment_secrets` |
| MON-06 | 同: `test_duplicate_workspace_alias_is_rejected_without_touching_worker`, `test_different_workspaces_can_run_concurrently`, `test_success_and_failure_release_workspace_lock`; `scripts/test-delegate-cursor-state.py`: `test_same_workspace_is_exclusive_and_different_workspaces_run_in_parallel`, `test_interruption_and_worker_failure_release_lock_for_retry` |
| MON-07 | 同: `test_interrupt_is_forwarded_and_recorded`, `test_sigterm_is_forwarded_and_not_reported_as_success`, `test_interrupt_does_not_stop_other_workspace_worker` |
| MON-08 | `backend/tests/test_delegate_cursor_monitor.py`: `test_status_snapshot_updates_are_memory_only_until_checkpoint`, `test_stream_events_are_persisted_at_heartbeat_and_exit_not_per_event`, `test_old_diagnostic_logs_are_pruned_on_next_run`; `scripts/test-delegate-cursor-state.py`: `test_lock_file_requires_private_regular_single_link_file`, `test_diagnostic_retention_removes_only_owned_safe_logs`, `test_status_heartbeat_and_sanitized_failure_diagnostics_are_preserved` |

これらはCursor APIを使わないfake Workerと隔離されたstate directoryで実行します。
契約はテスト名と外部出力・保存状態の観測を対応付けています。

## price-memoでのテスト対応

price-memoの契約IDごとの実テスト対応は、同リポジトリの
[cursor-monitor-contract.md](https://github.com/nakakonakako/price-memo/blob/main/docs/cursor-monitor-contract.md)
を参照してください。price-memo PR #54でv1を適用し、独立した契約テストと
`npm run check`への組み込みを記録しています。上記の採用記録に示すPR merge commitと
`pr-quality`の結果は、price-memo側の採用確認です。receipt-managerのテスト対応表を
price-memoのテスト実行結果や保証として読み替えません。

## 許容するアプリ固有差分

- receipt-managerは、heartbeat等で更新するstatus JSONと、redaction後の
  bounded stderr診断抜粋を別々に保存します。状態・診断ディレクトリはprivate
  modeで検査され、診断は最大12行/8 KiB、20ファイル、7日保持です。
- price-memoは、失敗時に分類済みのallowlist metadataを保存し、未加工stderrや
  report本文を永続化しない方式です。
- 上記は内部設計の差であり、MON-05/08の制限を満たす限り統一しません。
  一方、実際に保存される情報、最大サイズ・件数・保持期間、mode/ownership、
  失敗時の動作は各repoの文書とテストで明示します。

## 未検証・保証の限界

- Cursorの実API、実アカウント認証、外部ネットワーク障害はこの契約テストでは
  実行しません。
- secret maskingは既知形式とテスト値を対象とするbest-effortです。未知の形式、
  分割された秘密値、任意のユーザー入力を完全に検出する保証はありません。
- OSや実行環境ごとの全process-tree挙動、強制kill、電源断、ファイルシステム障害時
  の回復は網羅していません。
- receipt-managerのSIGINT/SIGTERMテストはfake Workerでの観測です。別workspace
  のWorkerに影響しないこともテスト対象ですが、任意の外部プロセスへの作用を
  一般化して保証するものではありません。
- 不正・巨大入力に対する具体的なbyte上限、保存件数、保持期間は各repoの個別設定を
  維持します。上限を契約上の最小値として読み替えないでください。

## 契約の更新手順

1. 共通動作を変える場合、この文書の契約バージョンと該当IDを更新し、正常・異常
   条件とテスト可能な外部観測を明記します。
2. まず一方のrepoで実装・契約テスト・文書を更新し、そのPRで既存挙動への影響を
   レビューします。もう一方には別PRで反映し、同じIDのテスト対応を確認します。
3. 各repoの採用状態は、反映したPR/commitとCI結果を記録して判断します。片方の
   変更だけで両repoが準拠したとは扱いません。
4. 共通ライブラリ、外部repoを参照するCI、両repoを一括変更するWorkerは導入せず、
   各repoの独立実装と契約テストを維持します。

## MON-09: 明示的な利用枠切れと引き継ぎ

対応テスト: `test_usage_exhaustion_requires_failed_cli_diagnostic`,
`test_usage_words_in_worker_result_are_not_cli_evidence`,
`test_usage_failure_keeps_partial_workspace_and_does_not_retry`

失敗時に観測済み CLI の `ActionRequiredError` と明示的な利用枠切れ文言を
stderr から検出し、`cursor_usage_exhausted` を報告する。ANSI と分割入力を
扱い、成功・中断・通常の文章や容量不足だけでは判定しない。Supervisor は
再試行せず、既存変更を保護して同じ worktree で引き継ぐ。構造化 quota エラーの
外部形式は未確認であり推測しない。
