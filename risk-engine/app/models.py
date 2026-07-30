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


class SimulateRequest(BaseModel):
    holdings: list[Holding]
    series: list[PriceSeries]
    market_drop_pct: float = Field(le=0, ge=-100)  # negative: -20 = 20% drop


class PerAssetImpact(BaseModel):
    asset_id: str
    beta: float
    value_before: float
    value_after: float
    change_pct: float


class SimulateResponse(BaseModel):
    market_drop_pct: float
    total_before: float
    total_after: float
    projected_loss: float
    projected_loss_pct: float
    per_asset: list[PerAssetImpact]
