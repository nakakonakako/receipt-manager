import asyncio
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from app.services.ai_quota_db import AiQuotaDatabase
from app.services.ai_usage import GeminiOutputError, TokenUsage

logger = logging.getLogger(__name__)

AI_KINDS = frozenset({"ocr", "chat", "csv_estimate"})
KNOWN_OUTCOMES = frozenset({"granted", "rejected", "idempotent"})
KNOWN_REJECT_REASONS = frozenset(
    {
        "idempotency_conflict",
        "emergency_stop",
        "unknown_usage_breaker",
        "daily_limit_user",
        "daily_limit_global",
        "concurrency_user",
        "concurrency_global",
        "monthly_cost_cap",
    }
)
DAILY_REASONS = frozenset({"daily_limit_user", "daily_limit_global"})
CONCURRENCY_REASONS = frozenset({"concurrency_user", "concurrency_global"})
ACCEPTED_FINISH_OUTCOMES = frozenset({"finished", "idempotent"})

DETAIL_DAILY = "本日のAI利用回数の上限に達しました。明日再度お試しください。"
DETAIL_CONCURRENCY = "ほかのAI処理が実行中です。時間をおいて再度お試しください。"
DETAIL_UNAVAILABLE = "現在AI機能を利用できません。時間をおいて再度お試しください。"

RENEW_INTERVAL_SECONDS = 30
FINISH_ATTEMPTS = 3
FINISH_RETRY_DELAY_SECONDS = 0.2
DRAIN_TIMEOUT_SECONDS = 130


class AiQuotaDenied(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__("AI quota denied")


class AiQuotaGuard:
    def __init__(
        self,
        database: AiQuotaDatabase,
        renew_interval_seconds: float = RENEW_INTERVAL_SECONDS,
        finish_attempts: int = FINISH_ATTEMPTS,
        finish_retry_delay_seconds: float = FINISH_RETRY_DELAY_SECONDS,
    ):
        self.database = database
        self.renew_interval_seconds = renew_interval_seconds
        self.finish_attempts = finish_attempts
        self.finish_retry_delay_seconds = finish_retry_delay_seconds
        self._tasks: set[asyncio.Task[Any]] = set()

    async def execute(
        self,
        user_id: uuid.UUID,
        kind: str,
        operation: Callable[[], Awaitable[tuple[Any, TokenUsage]]],
    ) -> Any:
        if kind not in AI_KINDS or not self.database.available:
            logger.error("AI quota database configuration is unavailable")
            raise AiQuotaDenied(503, DETAIL_UNAVAILABLE)
        request_id = str(uuid.uuid4())
        claim = await self._claim(request_id, str(user_id), kind)
        outcome = str(claim.get("outcome") or "")
        if outcome != "granted":
            raise self._denial(outcome, claim.get("reject_reason"))
        task = asyncio.create_task(
            self._run_granted(request_id, operation),
            name="ai-quota-request",
        )
        self._track(task)
        return await asyncio.shield(task)

    async def drain(self) -> None:
        pending = {task for task in self._tasks if not task.done()}
        if not pending:
            return
        _, remaining = await asyncio.wait(pending, timeout=DRAIN_TIMEOUT_SECONDS)
        for task in remaining:
            task.cancel()
        if remaining:
            await asyncio.wait(remaining, timeout=1)

    async def _claim(self, request_id: str, user_id: str, kind: str) -> dict[str, Any]:
        try:
            return await self.database.claim(request_id, user_id, kind)
        except Exception:
            logger.error("AI quota claim failed")
            raise AiQuotaDenied(503, DETAIL_UNAVAILABLE) from None

    async def _run_granted(
        self,
        request_id: str,
        operation: Callable[[], Awaitable[tuple[Any, TokenUsage]]],
    ) -> Any:
        renew_task = asyncio.create_task(
            self._renew_loop(request_id),
            name="ai-quota-renew",
        )
        self._track(renew_task)
        succeeded = False
        usage = TokenUsage.unavailable()
        try:
            value, usage = await operation()
            succeeded = True
            return value
        except GeminiOutputError as exc:
            usage = exc.usage
            succeeded = False
            raise
        finally:
            renew_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renew_task
            finish_task = asyncio.create_task(
                self._finish_with_retry(request_id, succeeded, usage),
                name="ai-quota-finish",
            )
            self._track(finish_task)
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.shield(finish_task)

    async def _renew_loop(self, request_id: str) -> None:
        try:
            while True:
                await asyncio.sleep(self.renew_interval_seconds)
                try:
                    await self.database.renew(request_id)
                except Exception:
                    logger.error("AI quota lease renew failed")
        except asyncio.CancelledError:
            return

    async def _finish_with_retry(
        self, request_id: str, succeeded: bool, usage: TokenUsage
    ) -> None:
        if usage.usage_available:
            payload = (
                request_id,
                succeeded,
                True,
                usage.input_tokens,
                usage.output_tokens,
                usage.thought_tokens,
            )
        else:
            payload = (request_id, succeeded, False, None, None, None)
        for attempt in range(self.finish_attempts):
            try:
                row = await self.database.finish(*payload)
            except Exception:
                logger.error("AI quota finish failed")
                if attempt + 1 == self.finish_attempts:
                    return
                await asyncio.sleep(self.finish_retry_delay_seconds)
                continue
            outcome = str(row.get("outcome") or "")
            if outcome in ACCEPTED_FINISH_OUTCOMES:
                return
            logger.error("AI quota finish was not accepted")
            return

    def _denial(self, outcome: str, reason: Any) -> AiQuotaDenied:
        safe_reason = reason if reason in KNOWN_REJECT_REASONS else "unexpected"
        if outcome not in KNOWN_OUTCOMES:
            safe_reason = "unexpected"
        logger.warning("AI quota claim was not granted: %s", safe_reason)
        if outcome == "rejected" and reason in DAILY_REASONS:
            return AiQuotaDenied(429, DETAIL_DAILY)
        if outcome == "rejected" and reason in CONCURRENCY_REASONS:
            return AiQuotaDenied(429, DETAIL_CONCURRENCY)
        return AiQuotaDenied(503, DETAIL_UNAVAILABLE)

    def _track(self, task: asyncio.Task[Any]) -> None:
        self._tasks.add(task)
        task.add_done_callback(self._on_task_done)

    def _on_task_done(self, task: asyncio.Task[Any]) -> None:
        self._tasks.discard(task)
        # A disconnected caller drops the shield awaiter. Retrieve the outcome
        # so asyncio does not log it later. This does not clear the error for
        # an awaiter that is still waiting, and it does not record the text.
        if task.cancelled():
            return
        try:
            task.exception()
        except asyncio.CancelledError:
            return
