"""Endpoint tests for the risk engine API.

Covers the request/response contract the Node API depends on, plus the
validation boundaries that protect the service from malformed input.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def series(asset_id: str, prices: list[float]) -> dict:
    return {"asset_id": asset_id, "prices": prices}


def flat(n: int = 30, v: float = 1.0) -> list[float]:
    return [v] * n


def oscillating(n: int = 30, start: float = 100.0, amp: float = 0.05) -> list[float]:
    out = [start]
    for i in range(n - 1):
        out.append(out[-1] * (1 + amp if i % 2 == 0 else 1 - amp))
    return out


class TestHealth:
    def test_health_reports_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"ok": True, "service": "cryptolens-risk-engine"}


class TestMetricsEndpoint:
    def test_returns_expected_shape(self):
        r = client.post("/metrics", json={
            "holdings": [{"asset_id": "bitcoin", "value_usd": 1000}],
            "series": [series("bitcoin", oscillating())],
        })
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"volatility_annualized", "concentration_hhi", "concentration_rating"}
        assert body["concentration_rating"] in {"Low", "Moderate", "High"}

    def test_single_asset_is_high_concentration(self):
        r = client.post("/metrics", json={
            "holdings": [{"asset_id": "bitcoin", "value_usd": 1000}],
            "series": [series("bitcoin", oscillating())],
        })
        body = r.json()
        assert body["concentration_hhi"] == pytest.approx(1.0)
        assert body["concentration_rating"] == "High"

    def test_diversified_portfolio_is_low_concentration(self):
        holdings = [{"asset_id": f"asset{i}", "value_usd": 100} for i in range(6)]
        srs = [series(f"asset{i}", oscillating()) for i in range(6)]
        body = client.post("/metrics", json={"holdings": holdings, "series": srs}).json()
        assert body["concentration_rating"] == "Low"

    def test_stablecoin_portfolio_reports_calm_volatility(self):
        body = client.post("/metrics", json={
            "holdings": [{"asset_id": "usd-coin", "value_usd": 500}],
            "series": [series("usd-coin", flat())],
        }).json()
        assert body["volatility_annualized"] < 0.01

    def test_missing_series_still_returns_concentration(self):
        """History can be missing for a newly added asset — the endpoint must
        still return usable concentration rather than failing."""
        body = client.post("/metrics", json={
            "holdings": [{"asset_id": "newcoin", "value_usd": 100}],
            "series": [],
        }).json()
        assert body["concentration_hhi"] == pytest.approx(1.0)
        assert body["volatility_annualized"] == 0.0

    def test_empty_portfolio_is_handled(self):
        body = client.post("/metrics", json={"holdings": [], "series": []}).json()
        assert body["concentration_hhi"] == 0.0

    def test_rejects_negative_holding_value(self):
        r = client.post("/metrics", json={
            "holdings": [{"asset_id": "bitcoin", "value_usd": -100}],
            "series": [series("bitcoin", oscillating())],
        })
        assert r.status_code == 422

    def test_rejects_series_with_single_price(self):
        r = client.post("/metrics", json={
            "holdings": [{"asset_id": "bitcoin", "value_usd": 100}],
            "series": [series("bitcoin", [100.0])],
        })
        assert r.status_code == 422

    def test_rejects_malformed_body(self):
        assert client.post("/metrics", json={"nonsense": True}).status_code == 422


class TestSimulateEndpoint:
    def _payload(self, drop: float):
        market = oscillating(amp=0.03)
        amplified = [100.0]
        for i in range(1, len(market)):
            r = market[i] / market[i - 1] - 1
            amplified.append(amplified[-1] * (1 + 2 * r))
        return {
            "holdings": [
                {"asset_id": "bitcoin", "value_usd": 5000},
                {"asset_id": "solana", "value_usd": 3000},
                {"asset_id": "usd-coin", "value_usd": 2000},
            ],
            "series": [
                series("bitcoin", market),
                series("solana", amplified),
                series("usd-coin", flat()),
            ],
            "market_drop_pct": drop,
        }

    def test_returns_expected_shape(self):
        r = client.post("/simulate", json=self._payload(-20))
        assert r.status_code == 200
        body = r.json()
        assert set(body) >= {"total_before", "total_after", "projected_loss",
                             "projected_loss_pct", "per_asset"}
        assert len(body["per_asset"]) == 3

    def test_loss_is_negative_for_a_drop(self):
        body = client.post("/simulate", json=self._payload(-20)).json()
        assert body["projected_loss"] < 0
        assert body["total_after"] < body["total_before"]

    def test_beta_ordering_is_reflected_in_impact(self):
        body = client.post("/simulate", json=self._payload(-20)).json()
        by_id = {a["asset_id"]: a for a in body["per_asset"]}
        assert by_id["solana"]["change_pct"] < by_id["bitcoin"]["change_pct"] < by_id["usd-coin"]["change_pct"]

    def test_bigger_drop_means_bigger_loss(self):
        small = client.post("/simulate", json=self._payload(-10)).json()
        big = client.post("/simulate", json=self._payload(-40)).json()
        assert big["projected_loss"] < small["projected_loss"]

    def test_rejects_positive_drop(self):
        assert client.post("/simulate", json=self._payload(20)).status_code == 422

    def test_rejects_drop_beyond_negative_100(self):
        assert client.post("/simulate", json=self._payload(-150)).status_code == 422


class TestTrendEndpoint:
    def _series(self, values):
        return [{"day": f"2026-07-{i+1:02d}", "value": v} for i, v in enumerate(values)]

    def test_returns_one_point_per_day(self):
        r = client.post("/trend", json={"series": self._series(oscillating(n=30)), "window": 7})
        assert r.status_code == 200
        assert len(r.json()["points"]) == 30

    def test_early_points_are_null_until_window_fills(self):
        pts = client.post("/trend", json={
            "series": self._series(oscillating(n=30)), "window": 7}).json()["points"]
        assert pts[0]["volatility"] is None
        assert pts[-1]["volatility"] is not None

    def test_flat_value_series_is_zero_volatility(self):
        pts = client.post("/trend", json={
            "series": self._series(flat(30, 1000.0)), "window": 7}).json()["points"]
        vals = [p["volatility"] for p in pts if p["volatility"] is not None]
        assert vals and all(v == 0 for v in vals)

    def test_default_window_is_applied(self):
        r = client.post("/trend", json={"series": self._series(oscillating(n=20))})
        assert r.status_code == 200

    def test_rejects_out_of_range_window(self):
        s = self._series(oscillating(n=20))
        assert client.post("/trend", json={"series": s, "window": 1}).status_code == 422
        assert client.post("/trend", json={"series": s, "window": 99}).status_code == 422
