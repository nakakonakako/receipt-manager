# Database migration deployment

The shared database migration inventory and full production history belong to
`shared-supabase-db`. Receipt Manager keeps its application DB contract in
`db-contracts/receipt-manager.json`; its local `supabase/migrations/` files are
not used as the full production migration inventory.

Receipt Manager's production deployment runs the pinned shared Consumer Reader
gate, which requires Production DB identity, shared history `IN_SYNC`, and a
static pass for the deployed application commit. The workflow also runs the
RPC, AI quota, and ACL integrity diagnostics. Only `PASS` allows image build
and VPS deployment. It does not apply migrations. The gate stops on pending or
remote-only history, contract mismatch, integrity mismatch, or execution
failure.

Production migration application is not available from this repository's
workflows. The prior production apply and one-time Reader bootstrap workflows,
the local history checker used by those workflows, and their database URL
writer helper have been removed. Existing local disposable-database tests for
Reader permissions remain separate from hosted DB operation.

See [production-database-migration-gate.md](./production-database-migration-gate.md)
for current Reader and Writer verification status, retained legacy Production
Writer Secret conditions, and the shared Writer operating procedure.

Dev and Prod Reader checks and Writer credential read-only identity probes have
succeeded. Dev history is `IN_SYNC`; actual Dev and Prod `PENDING` migration
application remains unverified, and the Dev no-op is not proof of apply
capability. The shared Writer enable flags remain false. The receipt-manager
Production Writer Secret stays until a shared Production `PENDING` apply,
Reader postflight, both apps' DB compatibility and production deployment, and
an audit for old Writer references have succeeded. Deletion still requires
separate approval.
