from fastapi import FastAPI

from .models import MetricsRequest, MetricsResponse
from .risk import hhi, hhi_rating, portfolio_volatility

app = FastAPI(title="CryptoLens Risk Engine", version="0.1.0")


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
