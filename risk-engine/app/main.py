import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .models import (
    MetricsRequest, MetricsResponse, SimulateRequest, SimulateResponse,
    TrendRequest, TrendResponse,
)
from .risk import hhi, hhi_rating, portfolio_volatility, simulate_drawdown, volatility_trend

log = logging.getLogger("cryptolens.engine")
app = FastAPI(title="CryptoLens Risk Engine", version="1.0.0")


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    """Week 7: never leak stack traces to callers; log server-side instead."""
    log.exception("Unhandled error in risk engine: %s", exc)
    return JSONResponse(status_code=500, content={"error": "Internal computation error"})


@app.get("/health")
def health():
    return {"ok": True, "service": "cryptolens-risk-engine"}


@app.post("/metrics", response_model=MetricsResponse)
def metrics(req: MetricsRequest) -> MetricsResponse:
    values = [h.value_usd for h in req.holdings]
    total = sum(values)
    weights = {h.asset_id: (h.value_usd / total if total > 0 else 0.0) for h in req.holdings}
    series = {s.asset_id: s.prices for s in req.series}
    score = hhi(values)
    return MetricsResponse(
        volatility_annualized=round(portfolio_volatility(series, weights), 4),
        concentration_hhi=round(score, 4),
        concentration_rating=hhi_rating(score),
    )


@app.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    series = {s.asset_id: s.prices for s in req.series}
    holdings = [{"asset_id": h.asset_id, "value_usd": h.value_usd} for h in req.holdings]
    return SimulateResponse(**simulate_drawdown(holdings, series, req.market_drop_pct))


@app.post("/trend", response_model=TrendResponse)
def trend(req: TrendRequest) -> TrendResponse:
    pts = volatility_trend([{"day": p.day, "value": p.value} for p in req.series], req.window)
    return TrendResponse(points=[{"day": p["day"], "volatility": p["volatility"]} for p in pts])
