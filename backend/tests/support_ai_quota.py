import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from app import main

TEST_USER_ID = "11111111-1111-4111-8111-111111111111"


class GrantingQuotaDatabase:
    available = True

    def __init__(self):
        self.claim_calls = []
        self.renew_calls = []
        self.finish_calls = []
        self.claim_outcome = "granted"
        self.reject_reason = None
        self.fail_claim = False
        self.claim_error = None
        self.finish_failures_remaining = 0
        self.renew_error = None

    async def claim(self, request_id, user_id, kind):
        self.claim_calls.append((request_id, user_id, kind))
        if self.claim_error is not None:
            raise self.claim_error
        if self.fail_claim:
            raise RuntimeError("quota-database-unavailable")
        return {"outcome": self.claim_outcome, "reject_reason": self.reject_reason}

    async def renew(self, request_id):
        self.renew_calls.append(request_id)
        if self.renew_error is not None:
            raise self.renew_error
        return {"outcome": "renewed", "reject_reason": None}

    async def finish(
        self,
        request_id,
        succeeded,
        usage_available,
        input_tokens,
        output_tokens,
        thought_tokens,
    ):
        payload = (
            request_id,
            succeeded,
            usage_available,
            input_tokens,
            output_tokens,
            thought_tokens,
        )
        self.finish_calls.append(payload)
        if self.finish_failures_remaining:
            self.finish_failures_remaining -= 1
            raise RuntimeError("finish-database-unavailable")
        return {"outcome": "finished", "reject_reason": None}


def install_granting_quota(test: unittest.TestCase) -> GrantingQuotaDatabase:
    database = GrantingQuotaDatabase()
    previous = main.ai_quota_guard.database
    main.ai_quota_guard.database = database

    def restore():
        main.ai_quota_guard.database = previous

    test.addCleanup(restore)
    return database


def ensure_user_id(service):
    user_id = getattr(service, "user_id", None)
    if isinstance(user_id, str):
        return service
    if isinstance(service, Mock):
        service.user_id = TEST_USER_ID
        return service
    return SimpleNamespace(user_id=TEST_USER_ID)
