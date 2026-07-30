"""Core risk math.
Week 2: volatility + HHI foundation.
Week 5: per-asset beta to a market proxy + drawdown simulation."""
import numpy as np
import pandas as pd

TRADING_DAYS = 365  # crypto trades every day

# Market proxy for beta: we treat BTC as "the market" for crypto. If BTC isn't
# held, we fall back to ETH, then to an equal-weighted basket of what's present.
MARKET_PROXIES = ["bitcoin", "ethereum"]


def _log_returns(prices: list[float]) -> pd.Series:
    s = pd.Series(prices, dtype="float64")
    return np.log(s / s.shift(1)).dropna()


def annualized_volatility(prices: list[float]) -> float:
    returns = _log_returns(prices)
    if returns.empty:
        return 0.0
    return float(returns.std(ddof=1) * np.sqrt(TRADING_DAYS))


def portfolio_volatility(series: dict[str, list[float]], weights: dict[str, float]) -> float:
    """Weighted portfolio volatility from asset return series (covariance approach)."""
    frames = {aid: pd.Series(p, dtype="float64") for aid, p in series.items() if aid in weights}
    if not frames:
        return 0.0
    n = min(len(s) for s in frames.values())
    rets = pd.DataFrame({
        aid: np.log(s.iloc[-n:].reset_index(drop=True) / s.iloc[-n:].reset_index(drop=True).shift(1))
        for aid, s in frames.items()
    }).dropna()
    if len(rets) < 2:
        return 0.0
    w = np.array([weights[c] for c in rets.columns])
    cov = rets.cov().to_numpy()
    daily_var = float(w @ cov @ w)
    if not np.isfinite(daily_var):
        return 0.0
    return float(np.sqrt(max(daily_var, 0.0)) * np.sqrt(TRADING_DAYS))


def hhi(values: list[float]) -> float:
    """Herfindahl-Hirschman Index on portfolio weights: 1/n (diversified) -> 1.0 (all-in)."""
    total = sum(values)
    if total <= 0:
        return 0.0
    return sum((v / total) ** 2 for v in values)


def hhi_rating(score: float) -> str:
    if score < 0.25:
        return "Low"
    if score < 0.50:
        return "Moderate"
    return "High"


def _pick_market_series(series: dict[str, list[float]]) -> list[float] | None:
    for proxy in MARKET_PROXIES:
        if proxy in series and len(series[proxy]) >= 3:
            return series[proxy]
    return None


def asset_beta(asset_prices: list[float], market_prices: list[float]) -> float:
    """Beta = cov(asset, market) / var(market), on daily log returns.
    Beta ~1 moves with the market; >1 amplifies; <1 dampens; ~0 (stablecoin) barely moves."""
    a = _log_returns(asset_prices)
    m = _log_returns(market_prices)
    n = min(len(a), len(m))
    if n < 2:
        return 1.0  # neutral default when we can't estimate
    a = a.iloc[-n:].reset_index(drop=True)
    m = m.iloc[-n:].reset_index(drop=True)
    var_m = float(m.var(ddof=1))
    if var_m <= 0 or not np.isfinite(var_m):
        return 1.0
    cov_am = float(np.cov(a, m, ddof=1)[0, 1])
    beta = cov_am / var_m
    if not np.isfinite(beta):
        return 1.0
    # Clamp to a sane range so a noisy 30-day estimate can't produce absurd values
    return float(max(-1.0, min(3.0, beta)))


def simulate_drawdown(
    holdings: list[dict],           # [{asset_id, value_usd}]
    series: dict[str, list[float]], # asset_id -> daily prices
    market_drop_pct: float,         # e.g. -20 for a 20% market drop
) -> dict:
    """Model portfolio value under a market move, scaling each asset by its beta.
    A -20% *market* move hits a beta-1.5 asset ~-30% and a beta-0 stablecoin ~0%."""
    market_series = _pick_market_series(series)
    drop_frac = market_drop_pct / 100.0

    per_asset = []
    total_before = 0.0
    total_after = 0.0
    for h in holdings:
        aid = h["asset_id"]
        value = float(h["value_usd"])
        total_before += value

        if market_series and aid in series and len(series[aid]) >= 3:
            beta = asset_beta(series[aid], market_series)
        elif aid in series and len(series[aid]) >= 3:
            # No market proxy available (e.g. a stablecoin-only portfolio).
            # Estimate a beta proxy from the asset's own volatility relative to a
            # typical crypto daily vol (~4%), so a flat stablecoin stays near 0.
            own_vol = float(_log_returns(series[aid]).std(ddof=1))
            beta = float(max(0.0, min(3.0, own_vol / 0.04))) if np.isfinite(own_vol) else 1.0
        else:
            beta = 1.0  # no history at all -> assume it moves with the market
        asset_move = beta * drop_frac
        after = value * (1 + asset_move)
        total_after += after
        per_asset.append({
            "asset_id": aid,
            "beta": round(beta, 3),
            "value_before": round(value, 2),
            "value_after": round(after, 2),
            "change_pct": round(asset_move * 100, 2),
        })

    loss = total_after - total_before
    per_asset.sort(key=lambda x: x["value_after"] - x["value_before"])  # worst hit first
    return {
        "market_drop_pct": market_drop_pct,
        "total_before": round(total_before, 2),
        "total_after": round(total_after, 2),
        "projected_loss": round(loss, 2),
        "projected_loss_pct": round((loss / total_before * 100) if total_before > 0 else 0.0, 2),
        "per_asset": per_asset,
    }
