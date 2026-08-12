"""Core risk math for CryptoLens.

Week 2: volatility + HHI.  Week 5: beta + drawdown simulation.
Week 6: rolling volatility trend.  Week 7: hardened input handling.
"""
import numpy as np
import pandas as pd

TRADING_DAYS = 365          # crypto trades every day
MARKET_PROXIES = ["bitcoin", "ethereum"]
BETA_MIN, BETA_MAX = -1.0, 3.0   # clamp: a noisy 30d estimate shouldn't run wild
TYPICAL_DAILY_VOL = 0.04         # fallback scale when no market proxy exists


def _clean(prices: list[float]) -> list[float]:
    """Drop non-finite and non-positive prices — log returns need positive values."""
    return [float(p) for p in prices if isinstance(p, (int, float))
            and np.isfinite(p) and p > 0]


def _log_returns(prices: list[float]) -> pd.Series:
    clean = _clean(prices)
    if len(clean) < 2:
        return pd.Series(dtype="float64")
    s = pd.Series(clean, dtype="float64")
    r = np.log(s / s.shift(1)).dropna()
    return r[np.isfinite(r)]


def annualized_volatility(prices: list[float]) -> float:
    r = _log_returns(prices)
    if len(r) < 2:
        return 0.0
    v = float(r.std(ddof=1) * np.sqrt(TRADING_DAYS))
    return v if np.isfinite(v) else 0.0


def portfolio_volatility(series: dict[str, list[float]], weights: dict[str, float]) -> float:
    """Covariance-weighted portfolio volatility: sqrt(wᵀ Σ w), annualized."""
    frames = {aid: pd.Series(_clean(p), dtype="float64")
              for aid, p in series.items() if aid in weights}
    frames = {k: v for k, v in frames.items() if len(v) >= 2}
    if not frames:
        return 0.0
    n = min(len(s) for s in frames.values())
    if n < 2:
        return 0.0
    rets = pd.DataFrame({
        aid: np.log(s.iloc[-n:].reset_index(drop=True) / s.iloc[-n:].reset_index(drop=True).shift(1))
        for aid, s in frames.items()
    }).dropna()
    if len(rets) < 2:
        return 0.0
    w = np.array([weights.get(c, 0.0) for c in rets.columns])
    cov = rets.cov().to_numpy()
    daily_var = float(w @ cov @ w)
    if not np.isfinite(daily_var) or daily_var < 0:
        return 0.0
    return float(np.sqrt(daily_var) * np.sqrt(TRADING_DAYS))


def hhi(values: list[float]) -> float:
    """Herfindahl-Hirschman Index on weights: 1/n (even) .. 1.0 (all-in)."""
    vals = [float(v) for v in values if np.isfinite(v) and v > 0]
    total = sum(vals)
    if total <= 0:
        return 0.0
    return sum((v / total) ** 2 for v in vals)


def hhi_rating(score: float) -> str:
    if score < 0.25:
        return "Low"
    if score < 0.50:
        return "Moderate"
    return "High"


def _pick_market_series(series: dict[str, list[float]]) -> list[float] | None:
    for proxy in MARKET_PROXIES:
        if proxy in series and len(_clean(series[proxy])) >= 3:
            return series[proxy]
    return None


def asset_beta(asset_prices: list[float], market_prices: list[float]) -> float:
    """cov(asset, market) / var(market) on daily log returns, clamped."""
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
    return float(max(BETA_MIN, min(BETA_MAX, beta)))


def simulate_drawdown(holdings: list[dict], series: dict[str, list[float]],
                      market_drop_pct: float) -> dict:
    """Model portfolio value under a market move, scaling each asset by its beta."""
    market_series = _pick_market_series(series)
    drop_frac = market_drop_pct / 100.0

    per_asset, total_before, total_after = [], 0.0, 0.0
    for h in holdings:
        aid = h["asset_id"]
        value = float(h["value_usd"])
        total_before += value

        if market_series and aid in series and len(_clean(series[aid])) >= 3:
            beta = asset_beta(series[aid], market_series)
        elif aid in series and len(_clean(series[aid])) >= 3:
            # No market proxy (e.g. stablecoin-only portfolio): scale by the
            # asset's own volatility so a flat asset stays near zero.
            own_vol = float(_log_returns(series[aid]).std(ddof=1))
            beta = float(max(0.0, min(BETA_MAX, own_vol / TYPICAL_DAILY_VOL))) \
                if np.isfinite(own_vol) else 1.0
        else:
            beta = 1.0  # no history at all -> assume it tracks the market

        move = beta * drop_frac
        after = value * (1 + move)
        total_after += after
        per_asset.append({
            "asset_id": aid, "beta": round(beta, 3),
            "value_before": round(value, 2), "value_after": round(after, 2),
            "change_pct": round(move * 100, 2),
        })

    loss = total_after - total_before
    per_asset.sort(key=lambda x: x["value_after"] - x["value_before"])
    return {
        "market_drop_pct": market_drop_pct,
        "total_before": round(total_before, 2),
        "total_after": round(total_after, 2),
        "projected_loss": round(loss, 2),
        "projected_loss_pct": round((loss / total_before * 100) if total_before > 0 else 0.0, 2),
        "per_asset": per_asset,
    }


def volatility_trend(series: list[dict], window: int = 7) -> list[dict]:
    """Rolling annualized volatility of a portfolio value series (oldest first)."""
    if len(series) < 2:
        return [{"day": p["day"], "volatility": None} for p in series]

    days = [p["day"] for p in series]
    values = pd.Series([float(p["value"]) for p in series], dtype="float64")
    rets = np.log(values / values.shift(1))
    roll = rets.rolling(window=window, min_periods=window).std(ddof=1) * np.sqrt(TRADING_DAYS)

    return [{"day": d, "volatility": (round(float(v), 4) if pd.notna(v) and np.isfinite(v) else None)}
            for d, v in zip(days, roll)]
