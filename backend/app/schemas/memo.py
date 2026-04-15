from pydantic import BaseModel


class MemoRowUpsertRequest(BaseModel):
    query: str
    sort_order: int
