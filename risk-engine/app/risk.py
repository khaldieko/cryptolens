"""Core risk math. Week 2: working volatility + HHI foundation.
Week 4 will extend with per-asset betas and drawdown simulation."""
import numpy as np
import pandas as pd

TRADING_DAYS = 365  # crypto trades every day


def annualized_volatility(prices: list[float]) -> float:
    """30-day-style rolling volatility: std of daily log returns, annualized."""
    s = pd.Series(prices, dtype="float64")
    returns = np.log(s / s.shift(1)).dropna()
    if returns.empty:
        return 0.0
    return float(returns.std(ddof=1) * np.sqrt(TRADING_DAYS))


def portfolio_volatility(series: dict[str, list[float]], weights: dict[str, float]) -> float:
    """Weighted portfolio volatility from asset return series (simple covariance approach)."""
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
    """Herfindahl-Hirschman Index on portfolio weights: 1/n (diversified) → 1.0 (all-in)."""
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
