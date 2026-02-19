from pydantic import BaseModel


class PasswordCheck(BaseModel):
    password: str
