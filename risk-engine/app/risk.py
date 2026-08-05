"""Core risk math.
Week 2: volatility + HHI. Week 5: beta + drawdown simulation. Week 6: rolling volatility trend."""
import numpy as np
import pandas as pd

TRADING_DAYS = 365
MARKET_PROXIES = ["bitcoin", "ethereum"]


def _log_returns(prices: list[float]) -> pd.Series:
    s = pd.Series(prices, dtype="float64")
    return np.log(s / s.shift(1)).dropna()


def annualized_volatility(prices: list[float]) -> float:
    r = _log_returns(prices)
    if r.empty:
        return 0.0
    return float(r.std(ddof=1) * np.sqrt(TRADING_DAYS))


def portfolio_volatility(series: dict[str, list[float]], weights: dict[str, float]) -> float:
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
    a = _log_returns(asset_prices)
    m = _log_returns(market_prices)
    n = min(len(a), len(m))
    if n < 2:
        return 1.0
    a = a.iloc[-n:].reset_index(drop=True)
    m = m.iloc[-n:].reset_index(drop=True)
    var_m = float(m.var(ddof=1))
    if var_m <= 0 or not np.isfinite(var_m):
        return 1.0
    beta = float(np.cov(a, m, ddof=1)[0, 1]) / var_m
    if not np.isfinite(beta):
        return 1.0
    return float(max(-1.0, min(3.0, beta)))


def simulate_drawdown(holdings: list[dict], series: dict[str, list[float]], market_drop_pct: float) -> dict:
    market_series = _pick_market_series(series)
    drop_frac = market_drop_pct / 100.0
    per_asset, total_before, total_after = [], 0.0, 0.0
    for h in holdings:
        aid = h["asset_id"]
        value = float(h["value_usd"])
        total_before += value
        if market_series and aid in series and len(series[aid]) >= 3:
            beta = asset_beta(series[aid], market_series)
        elif aid in series and len(series[aid]) >= 3:
            own_vol = float(_log_returns(series[aid]).std(ddof=1))
            beta = float(max(0.0, min(3.0, own_vol / 0.04))) if np.isfinite(own_vol) else 1.0
        else:
            beta = 1.0
        move = beta * drop_frac
        after = value * (1 + move)
        total_after += after
        per_asset.append({"asset_id": aid, "beta": round(beta, 3), "value_before": round(value, 2),
                          "value_after": round(after, 2), "change_pct": round(move * 100, 2)})
    loss = total_after - total_before
    per_asset.sort(key=lambda x: x["value_after"] - x["value_before"])
    return {"market_drop_pct": market_drop_pct, "total_before": round(total_before, 2),
            "total_after": round(total_after, 2), "projected_loss": round(loss, 2),
            "projected_loss_pct": round((loss / total_before * 100) if total_before > 0 else 0.0, 2),
            "per_asset": per_asset}


def volatility_trend(series: list[dict], window: int = 7) -> list[dict]:
    """Rolling annualized volatility of a portfolio value series.
    `series` is [{day, value}] oldest-first. Returns [{day, volatility}] where
    volatility is None until the rolling window has enough observations."""
    if len(series) < 2:
        return [{"day": p["day"], "volatility": None} for p in series]

    days = [p["day"] for p in series]
    values = pd.Series([float(p["value"]) for p in series], dtype="float64")
    rets = np.log(values / values.shift(1))  # first entry is NaN

    # Rolling std of daily returns, annualized. min_periods keeps early points null.
    roll = rets.rolling(window=window, min_periods=window).std(ddof=1) * np.sqrt(TRADING_DAYS)

    out = []
    for day, v in zip(days, roll):
        out.append({"day": day, "volatility": (round(float(v), 4) if pd.notna(v) and np.isfinite(v) else None)})
    return out
