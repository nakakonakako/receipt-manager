import logging
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass

logger = logging.getLogger(__name__)

AI_QUOTA_ENV_FILE_CANDIDATES = ("/app/.env.ai-quota", ".env.ai-quota")
CONFIG_KEYS = (
    "AI_QUOTA_DB_HOST",
    "AI_QUOTA_DB_PORT",
    "AI_QUOTA_DB_NAME",
    "AI_QUOTA_DB_USER",
    "AI_QUOTA_DB_PASSWORD",
    "AI_QUOTA_DB_SSLROOTCERT",
)
SESSION_POOLER_PORT = 5432
DATABASE_NAME = "postgres"
USER_PATTERN = re.compile(r"^ai_quota_backend\.[a-z0-9]{1,40}\Z")
HOST_PATTERN = re.compile(r"^[A-Za-z0-9.-]{1,253}\Z")
FORBIDDEN_USER_MARKERS = (
    "postgres",
    "service_role",
    "authenticator",
    "supabase_admin",
    "ai_quota_owner",
)


class AiQuotaConfigError(Exception):
    def __str__(self) -> str:
        return "AI quota configuration is unavailable"


@dataclass(frozen=True)
class AiQuotaDbConfig:
    host: str
    port: int
    dbname: str
    user: str
    password: str
    sslrootcert: str

    def __repr__(self) -> str:
        return "AiQuotaDbConfig(redacted)"


def load_ai_quota_env_file() -> None:
    override = os.environ.get("AI_QUOTA_ENV_FILE")
    candidates = [override] if override else []
    candidates.extend(AI_QUOTA_ENV_FILE_CANDIDATES)
    for path in candidates:
        if path and os.path.isfile(path):
            from dotenv import load_dotenv

            load_dotenv(path, override=False)
            return


def load_ai_quota_config(
    environ: Mapping[str, str] | None = None,
) -> AiQuotaDbConfig | None:
    source = os.environ if environ is None else environ
    values = [source.get(key) for key in CONFIG_KEYS]
    if all(value is None or value == "" for value in values):
        return None
    return _build_config(source)


def _build_config(source: Mapping[str, str]) -> AiQuotaDbConfig:
    host = _required(source, "AI_QUOTA_DB_HOST")
    port_text = _required(source, "AI_QUOTA_DB_PORT")
    dbname = _required(source, "AI_QUOTA_DB_NAME")
    user = _required(source, "AI_QUOTA_DB_USER")
    password = _required(source, "AI_QUOTA_DB_PASSWORD")
    sslrootcert = _required(source, "AI_QUOTA_DB_SSLROOTCERT")

    if HOST_PATTERN.fullmatch(host) is None or ".." in host:
        raise AiQuotaConfigError()
    if port_text != str(SESSION_POOLER_PORT):
        raise AiQuotaConfigError()
    if dbname != DATABASE_NAME:
        raise AiQuotaConfigError()
    if not _valid_user(user):
        raise AiQuotaConfigError()
    if "\x00" in password or "\n" in password or "\r" in password:
        raise AiQuotaConfigError()
    if not os.path.isfile(sslrootcert):
        raise AiQuotaConfigError()

    return AiQuotaDbConfig(
        host=host,
        port=SESSION_POOLER_PORT,
        dbname=DATABASE_NAME,
        user=user,
        password=password,
        sslrootcert=sslrootcert,
    )


def _required(source: Mapping[str, str], key: str) -> str:
    value = source.get(key)
    if value is None or value == "" or value.strip() != value:
        raise AiQuotaConfigError()
    return value


def _valid_user(user: str) -> bool:
    if USER_PATTERN.fullmatch(user) is None:
        return False
    lowered = user.lower()
    return not any(marker in lowered for marker in FORBIDDEN_USER_MARKERS)
