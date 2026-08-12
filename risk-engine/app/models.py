from pydantic import BaseModel, Field


class PriceSeries(BaseModel):
    asset_id: str = Field(min_length=1, max_length=64)
    prices: list[float] = Field(min_length=2, max_length=400)


class Holding(BaseModel):
    asset_id: str = Field(min_length=1, max_length=64)
    value_usd: float = Field(ge=0)


class MetricsRequest(BaseModel):
    holdings: list[Holding] = Field(max_length=200)
    series: list[PriceSeries] = Field(max_length=200)


class MetricsResponse(BaseModel):
    volatility_annualized: float
    concentration_hhi: float
    concentration_rating: str


class SimulateRequest(BaseModel):
    holdings: list[Holding] = Field(max_length=200)
    series: list[PriceSeries] = Field(max_length=200)
    market_drop_pct: float = Field(le=0, ge=-100)


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


class ValuePoint(BaseModel):
    day: str = Field(min_length=1, max_length=32)
    value: float


class TrendRequest(BaseModel):
    series: list[ValuePoint] = Field(max_length=400)
    window: int = Field(default=7, ge=3, le=30)


class TrendPoint(BaseModel):
    day: str
    volatility: float | None


class TrendResponse(BaseModel):
    points: list[TrendPoint]
