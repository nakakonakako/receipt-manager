"""Gemini usage capture for ai_quota finish calls.

google-genai 1.53 `GenerateContentResponseUsageMetadata` leaves
`thoughts_token_count` unset when the JSON field is absent. The field is
documented as the thought count "if applicable", and `total_token_count` is
the sum of prompt, candidates, tool-use, and thoughts. The SDK copies the
field only when it is present, which is how an omitted proto zero arrives.
An omitted thought count is therefore zero. Prompt and candidate counts are
required; a missing, non-integer, or negative count makes usage unavailable.
"""

from dataclasses import dataclass
from typing import Any

TOKEN_COUNT_MAX = 1_000_000_000_000


@dataclass(frozen=True)
class TokenUsage:
    usage_available: bool
    input_tokens: int | None = None
    output_tokens: int | None = None
    thought_tokens: int | None = None

    @staticmethod
    def unavailable() -> "TokenUsage":
        return TokenUsage(False, None, None, None)


@dataclass(frozen=True)
class ModelResult:
    value: Any
    usage: TokenUsage


class GeminiOutputError(Exception):
    def __init__(self, usage: TokenUsage):
        self.usage = usage
        super().__init__("Gemini output was invalid")


class GeminiInvalidOutput(GeminiOutputError):
    pass


class GeminiSchemaRejected(GeminiOutputError):
    pass


def unwrap_model_result(result: Any) -> tuple[Any, TokenUsage]:
    if isinstance(result, ModelResult):
        return result.value, result.usage
    return result, TokenUsage.unavailable()


def token_usage_from_response(response: Any) -> TokenUsage:
    metadata = getattr(response, "usage_metadata", None)
    if metadata is None and isinstance(response, dict):
        metadata = response.get("usage_metadata")
    return token_usage_from_metadata(metadata)


def token_usage_from_metadata(metadata: Any) -> TokenUsage:
    if metadata is None:
        return TokenUsage.unavailable()
    prompt = _required_count(metadata, "prompt_token_count")
    output = _required_count(metadata, "candidates_token_count")
    if prompt is None or output is None:
        return TokenUsage.unavailable()
    thought = _thought_count(metadata)
    if thought is None:
        return TokenUsage.unavailable()
    return TokenUsage(True, prompt, output, thought)


def _required_count(metadata: Any, name: str) -> int | None:
    if not _has_field(metadata, name):
        return None
    return _non_negative_count(_read_field(metadata, name))


def _thought_count(metadata: Any) -> int | None:
    if not _has_field(metadata, "thoughts_token_count"):
        return 0
    value = _read_field(metadata, "thoughts_token_count")
    if value is None:
        return 0
    return _non_negative_count(value)


def _has_field(metadata: Any, name: str) -> bool:
    if isinstance(metadata, dict):
        return name in metadata
    return hasattr(metadata, name)


def _read_field(metadata: Any, name: str) -> Any:
    if isinstance(metadata, dict):
        return metadata.get(name)
    return getattr(metadata, name, None)


def _non_negative_count(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < 0 or value > TOKEN_COUNT_MAX:
        return None
    return value
