from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class BaseSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=lambda s: "".join(
            word.capitalize() if i > 0 else word
            for i, word in enumerate(s.split("_"))
        )
    )

class CompanyProfile(BaseSchema):
    cik: str
    ticker: str
    name: str
    exchange: Optional[str] = "Unknown"
    sector: Optional[str] = "Unknown"
    industry: Optional[str] = "Unknown"
    sic: Optional[str] = None
    sic_description: Optional[str] = None
    fiscal_year_end: Optional[str] = None

    # Market Data (YFinance)
    current_price: Optional[float] = None
    market_cap: Optional[float] = None
    currency: Optional[str] = "USD"
    beta: Optional[float] = None
