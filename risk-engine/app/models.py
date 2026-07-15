from pydantic import BaseModel, Field


class PriceSeries(BaseModel):
    """Daily closing prices for one asset, oldest first."""
    asset_id: str
    prices: list[float] = Field(min_length=2)


class Holding(BaseModel):
    asset_id: str
    value_usd: float = Field(ge=0)


class MetricsRequest(BaseModel):
    holdings: list[Holding]
    series: list[PriceSeries]


class MetricsResponse(BaseModel):
    volatility_annualized: float
    concentration_hhi: float
    concentration_rating: str
