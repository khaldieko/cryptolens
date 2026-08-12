"""Unit tests for the CryptoLens risk math.

These cover the three metric families the product depends on:
volatility, concentration (HHI), beta/drawdown, and the rolling trend —
including the degenerate inputs that caused real bugs during development.
"""
import math

import pytest

from app.risk import (
    annualized_volatility, portfolio_volatility, hhi, hhi_rating,
    asset_beta, simulate_drawdown, volatility_trend, TRADING_DAYS,
)


# ---------- fixtures ----------

def flat(n: int = 30, value: float = 1.0) -> list[float]:
    """A stablecoin-like series: no movement at all."""
    return [value] * n


def trending(n: int = 30, start: float = 100.0, step: float = 0.01) -> list[float]:
    """Steady compounding growth — constant daily return, so volatility is ~0."""
    out = [start]
    for _ in range(n - 1):
        out.append(out[-1] * (1 + step))
    return out


def oscillating(n: int = 30, start: float = 100.0, amp: float = 0.05) -> list[float]:
    """Alternating up/down moves — a known, repeatable volatility."""
    out = [start]
    for i in range(n - 1):
        out.append(out[-1] * (1 + amp if i % 2 == 0 else 1 - amp))
    return out


# ---------- annualized_volatility ----------

class TestAnnualizedVolatility:
    def test_flat_series_has_zero_volatility(self):
        assert annualized_volatility(flat()) == 0.0

    def test_constant_growth_has_near_zero_volatility(self):
        # Same return every day => no dispersion => volatility ~ 0
        assert annualized_volatility(trending()) == pytest.approx(0.0, abs=1e-9)

    def test_oscillating_series_has_positive_volatility(self):
        assert annualized_volatility(oscillating()) > 0.5

    def test_more_movement_means_more_volatility(self):
        assert annualized_volatility(oscillating(amp=0.08)) > annualized_volatility(oscillating(amp=0.02))

    def test_annualization_uses_365_days(self):
        prices = oscillating(n=200, amp=0.03)
        from app.risk import _log_returns
        daily = float(_log_returns(prices).std(ddof=1))
        assert annualized_volatility(prices) == pytest.approx(daily * math.sqrt(TRADING_DAYS), rel=1e-9)

    @pytest.mark.parametrize("prices", [[], [100.0], [0.0, 0.0]])
    def test_degenerate_inputs_return_zero(self, prices):
        assert annualized_volatility(prices) == 0.0

    def test_non_finite_and_negative_prices_are_ignored(self):
        # Should not raise, and should not produce NaN
        v = annualized_volatility([100.0, float("nan"), -5.0, 102.0, 101.0])
        assert math.isfinite(v)


# ---------- portfolio_volatility ----------

class TestPortfolioVolatility:
    def test_stablecoin_only_portfolio_is_calm(self):
        v = portfolio_volatility({"usd-coin": flat()}, {"usd-coin": 1.0})
        assert v == pytest.approx(0.0, abs=1e-9)

    def test_volatile_single_asset_portfolio(self):
        v = portfolio_volatility({"solana": oscillating()}, {"solana": 1.0})
        assert v > 0.5

    def test_adding_a_stablecoin_reduces_portfolio_volatility(self):
        """The core diversification claim the dashboard makes."""
        volatile_only = portfolio_volatility(
            {"solana": oscillating()}, {"solana": 1.0})
        half_stable = portfolio_volatility(
            {"solana": oscillating(), "usd-coin": flat()},
            {"solana": 0.5, "usd-coin": 0.5})
        assert half_stable < volatile_only

    def test_empty_inputs_return_zero(self):
        assert portfolio_volatility({}, {}) == 0.0
        assert portfolio_volatility({"btc": [100.0]}, {"btc": 1.0}) == 0.0

    def test_series_of_differing_lengths_are_aligned(self):
        # Should use the overlapping window rather than crashing
        v = portfolio_volatility(
            {"a": oscillating(n=30), "b": oscillating(n=10)},
            {"a": 0.5, "b": 0.5})
        assert math.isfinite(v) and v >= 0


# ---------- HHI ----------

class TestConcentration:
    def test_single_asset_is_maximum_concentration(self):
        assert hhi([1000.0]) == pytest.approx(1.0)

    def test_evenly_split_equals_one_over_n(self):
        assert hhi([100.0] * 4) == pytest.approx(0.25)
        assert hhi([100.0] * 10) == pytest.approx(0.10)

    def test_squaring_punishes_a_dominant_position(self):
        dominant = hhi([900.0, 50.0, 50.0])
        balanced = hhi([333.0, 333.0, 334.0])
        assert dominant > balanced

    def test_known_value(self):
        # 60/30/10 split -> 0.36 + 0.09 + 0.01
        assert hhi([60.0, 30.0, 10.0]) == pytest.approx(0.46)

    def test_zero_or_empty_returns_zero(self):
        assert hhi([]) == 0.0
        assert hhi([0.0, 0.0]) == 0.0

    @pytest.mark.parametrize("score,expected", [
        (0.0, "Low"), (0.24, "Low"), (0.25, "Moderate"),
        (0.49, "Moderate"), (0.50, "High"), (1.0, "High"),
    ])
    def test_rating_thresholds(self, score, expected):
        assert hhi_rating(score) == expected


# ---------- beta ----------

class TestAssetBeta:
    def test_asset_identical_to_market_has_beta_one(self):
        market = oscillating()
        assert asset_beta(market, market) == pytest.approx(1.0, abs=1e-6)

    def test_amplified_asset_has_beta_above_one(self):
        market = oscillating(amp=0.03)
        # Build an asset that moves twice as much each day
        amplified = [100.0]
        for i in range(1, len(market)):
            r = market[i] / market[i - 1] - 1
            amplified.append(amplified[-1] * (1 + 2 * r))
        assert asset_beta(amplified, market) > 1.5

    def test_flat_asset_has_beta_near_zero(self):
        assert asset_beta(flat(), oscillating()) == pytest.approx(0.0, abs=0.05)

    def test_beta_is_clamped_to_sane_range(self):
        market = oscillating(amp=0.01)
        wild = [100.0]
        for i in range(1, len(market)):
            r = market[i] / market[i - 1] - 1
            wild.append(wild[-1] * (1 + 50 * r))
        assert asset_beta(wild, market) <= 3.0

    def test_insufficient_data_defaults_to_neutral(self):
        assert asset_beta([100.0], [100.0, 101.0]) == 1.0


# ---------- drawdown simulation ----------

class TestSimulateDrawdown:
    def _mixed(self):
        market = oscillating(amp=0.03)
        amplified = [100.0]
        for i in range(1, len(market)):
            r = market[i] / market[i - 1] - 1
            amplified.append(amplified[-1] * (1 + 2 * r))
        return {"bitcoin": market, "solana": amplified, "usd-coin": flat()}

    def test_market_asset_moves_with_the_market(self):
        res = simulate_drawdown(
            [{"asset_id": "bitcoin", "value_usd": 1000}], self._mixed(), -20)
        btc = res["per_asset"][0]
        assert btc["change_pct"] == pytest.approx(-20.0, abs=0.5)

    def test_high_beta_asset_falls_harder_than_market(self):
        res = simulate_drawdown(
            [{"asset_id": "bitcoin", "value_usd": 1000},
             {"asset_id": "solana", "value_usd": 1000}], self._mixed(), -20)
        by_id = {a["asset_id"]: a for a in res["per_asset"]}
        assert by_id["solana"]["change_pct"] < by_id["bitcoin"]["change_pct"]

    def test_stablecoin_barely_moves(self):
        res = simulate_drawdown(
            [{"asset_id": "usd-coin", "value_usd": 1000}], self._mixed(), -30)
        assert abs(res["per_asset"][0]["change_pct"]) < 2.0

    def test_stablecoin_only_portfolio_does_not_crash(self):
        """Regression: with no BTC/ETH proxy, beta used to default to 1.0 and
        a stablecoin portfolio lost the full scenario amount."""
        res = simulate_drawdown(
            [{"asset_id": "usd-coin", "value_usd": 1000}],
            {"usd-coin": flat()}, -50)
        assert abs(res["projected_loss"]) < 20

    def test_zero_drop_produces_no_loss(self):
        res = simulate_drawdown(
            [{"asset_id": "bitcoin", "value_usd": 5000}], self._mixed(), 0)
        assert res["projected_loss"] == pytest.approx(0.0, abs=0.01)

    def test_totals_are_internally_consistent(self):
        res = simulate_drawdown(
            [{"asset_id": "bitcoin", "value_usd": 5000},
             {"asset_id": "usd-coin", "value_usd": 5000}], self._mixed(), -20)
        assert res["total_before"] == pytest.approx(10000.0)
        assert res["total_after"] == pytest.approx(
            sum(a["value_after"] for a in res["per_asset"]), abs=0.05)
        assert res["projected_loss"] == pytest.approx(
            res["total_after"] - res["total_before"], abs=0.05)

    def test_worst_hit_asset_is_listed_first(self):
        res = simulate_drawdown(
            [{"asset_id": "bitcoin", "value_usd": 1000},
             {"asset_id": "solana", "value_usd": 1000},
             {"asset_id": "usd-coin", "value_usd": 1000}], self._mixed(), -25)
        assert res["per_asset"][0]["asset_id"] == "solana"

    def test_empty_portfolio_is_safe(self):
        res = simulate_drawdown([], {}, -20)
        assert res["total_before"] == 0 and res["projected_loss_pct"] == 0


# ---------- volatility trend ----------

class TestVolatilityTrend:
    def _series(self, values):
        return [{"day": f"2026-07-{i+1:02d}", "value": v} for i, v in enumerate(values)]

    def test_window_is_null_padded_until_it_fills(self):
        pts = volatility_trend(self._series(oscillating(n=30)), window=7)
        nulls = [p for p in pts if p["volatility"] is None]
        assert len(nulls) == 7  # 1 for the first return + 6 to fill the window

    def test_returns_one_point_per_input_day(self):
        pts = volatility_trend(self._series(oscillating(n=30)), window=7)
        assert len(pts) == 30

    def test_flat_portfolio_has_zero_trend_volatility(self):
        pts = volatility_trend(self._series(flat(30, 500.0)), window=7)
        vals = [p["volatility"] for p in pts if p["volatility"] is not None]
        assert vals and all(abs(v) < 1e-6 for v in vals)

    def test_volatile_portfolio_has_positive_trend(self):
        pts = volatility_trend(self._series(oscillating(n=30)), window=7)
        vals = [p["volatility"] for p in pts if p["volatility"] is not None]
        assert vals and all(v > 0 for v in vals)

    def test_short_series_returns_all_nulls(self):
        pts = volatility_trend(self._series([100.0]), window=7)
        assert all(p["volatility"] is None for p in pts)

    def test_days_are_preserved_in_order(self):
        series = self._series(oscillating(n=15))
        pts = volatility_trend(series, window=5)
        assert [p["day"] for p in pts] == [s["day"] for s in series]
