"""通用的响应形状。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Out(BaseModel):
    """响应模型的基类：可以直接从用例层的 dataclass 构造。"""

    model_config = ConfigDict(from_attributes=True)


class Problem(BaseModel):
    """RFC 9457 problem+json；code 是稳定的错误码，其余字段随错误不同。"""

    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    code: str
    retryable: bool = False
