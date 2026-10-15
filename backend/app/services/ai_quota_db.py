import logging
from collections.abc import Callable
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.services.ai_quota_config import AiQuotaDbConfig

logger = logging.getLogger(__name__)

PERMITTED_RPCS = frozenset({"claim_ai_request", "renew_ai_lease", "finish_ai_request"})
CLAIM_SQL = (
    "SELECT outcome, reject_reason, request_id, user_id, kind, status, "
    "lease_expires_at, started_at "
    "FROM ai_quota.claim_ai_request(%s, %s, %s)"
)
RENEW_SQL = (
    "SELECT outcome, reject_reason, request_id, lease_expires_at "
    "FROM ai_quota.renew_ai_lease(%s)"
)
FINISH_SQL = (
    "SELECT outcome, reject_reason, request_id, status, "
    "estimated_cost_micro_jpy, finished_at "
    "FROM ai_quota.finish_ai_request(%s, %s, %s, %s, %s, %s)"
)
RPC_SQL = {
    "claim_ai_request": CLAIM_SQL,
    "renew_ai_lease": RENEW_SQL,
    "finish_ai_request": FINISH_SQL,
}

CONNECT_TIMEOUT_SECONDS = 5
POOL_WAIT_SECONDS = 5
STATEMENT_TIMEOUT_MS = 5000
POOL_MIN_SIZE = 0
POOL_MAX_SIZE = 2
POOL_MAX_WAITING = 2
POOL_MAX_IDLE_SECONDS = 10
POOL_MAX_LIFETIME_SECONDS = 120
POOL_RECONNECT_TIMEOUT_SECONDS = 5


class AiQuotaDbError(Exception):
    def __str__(self) -> str:
        return "AI quota database request failed"


def connection_kwargs(config: AiQuotaDbConfig) -> dict[str, Any]:
    if not config.user.startswith("ai_quota_backend."):
        raise AiQuotaDbError()
    return {
        "host": config.host,
        "port": config.port,
        "dbname": config.dbname,
        "user": config.user,
        "password": config.password,
        "sslmode": "verify-full",
        "sslrootcert": config.sslrootcert,
        "connect_timeout": CONNECT_TIMEOUT_SECONDS,
        "application_name": "receipt-manager-ai-quota",
        "options": f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
    }


def pool_settings() -> dict[str, Any]:
    return {
        "min_size": POOL_MIN_SIZE,
        "max_size": POOL_MAX_SIZE,
        "timeout": POOL_WAIT_SECONDS,
        "max_waiting": POOL_MAX_WAITING,
        "max_idle": POOL_MAX_IDLE_SECONDS,
        "max_lifetime": POOL_MAX_LIFETIME_SECONDS,
        "reconnect_timeout": POOL_RECONNECT_TIMEOUT_SECONDS,
        "num_workers": 1,
        "open": False,
        "name": "ai-quota",
    }


def silence_driver_logs() -> None:
    for name in ("psycopg", "psycopg.pool"):
        library_logger = logging.getLogger(name)
        library_logger.setLevel(logging.CRITICAL + 1)
        library_logger.propagate = False


class AiQuotaDatabase:
    def __init__(
        self,
        config: AiQuotaDbConfig | None,
        pool_factory: Callable[..., Any] = AsyncConnectionPool,
    ):
        self._config = config
        self._pool_factory = pool_factory
        self._pool: Any | None = None
        silence_driver_logs()

    @property
    def available(self) -> bool:
        return self._pool is not None

    async def start(self) -> None:
        silence_driver_logs()
        if self._config is None or self._pool is not None:
            if self._config is None:
                logger.error("AI quota database configuration is unavailable")
            return
        try:
            self._pool = self._pool_factory(
                "",
                kwargs=connection_kwargs(self._config),
                **pool_settings(),
            )
            await self._pool.open()
        except Exception:
            self._pool = None
            logger.error("AI quota database pool failed to open")

    async def close(self) -> None:
        pool = self._pool
        self._pool = None
        if pool is None:
            return
        try:
            await pool.close()
        except Exception:
            logger.error("AI quota database pool failed to close")

    async def claim(self, request_id: str, user_id: str, kind: str) -> dict[str, Any]:
        return await self._call("claim_ai_request", (request_id, user_id, kind))

    async def renew(self, request_id: str) -> dict[str, Any]:
        return await self._call("renew_ai_lease", (request_id,))

    async def finish(
        self,
        request_id: str,
        succeeded: bool,
        usage_available: bool,
        input_tokens: int | None,
        output_tokens: int | None,
        thought_tokens: int | None,
    ) -> dict[str, Any]:
        return await self._call(
            "finish_ai_request",
            (
                request_id,
                succeeded,
                usage_available,
                input_tokens,
                output_tokens,
                thought_tokens,
            ),
        )

    async def _call(self, rpc_name: str, params: tuple[Any, ...]) -> dict[str, Any]:
        if rpc_name not in PERMITTED_RPCS or self._pool is None:
            raise AiQuotaDbError()
        sql = RPC_SQL[rpc_name]
        try:
            async with self._pool.connection(timeout=POOL_WAIT_SECONDS) as conn:
                async with conn.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(sql, params)
                    row = await cursor.fetchone()
        except AiQuotaDbError:
            raise
        except Exception:
            raise AiQuotaDbError() from None
        if not isinstance(row, dict) or not row.get("outcome"):
            raise AiQuotaDbError()
        return row
