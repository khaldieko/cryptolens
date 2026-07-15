# CryptoLens

Real-time crypto portfolio risk & volatility dashboard.
M.Sc. Computer Science capstone — Diekololaoluwa Akinwole.

## Architecture

| Service | Stack | Port |
|---|---|---|
| `frontend/` | React 18 + TypeScript (Vite) + Tailwind | 5173 |
| `api/` | Node.js + Express (TypeScript) | 4000 |
| `risk-engine/` | Python FastAPI | 8000 |
| Postgres | docker-compose | 5432 |
| Redis | docker-compose | 6379 |

## Local setup

```bash
# 1. Infrastructure (Postgres + Redis)
docker compose up -d

# 2. API
cd api
cp .env.example .env
npm install
npm run migrate     # creates tables
npm run dev         # http://localhost:4000

# 3. Risk engine
cd ../risk-engine
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000           # http://localhost:8000/docs

# 4. Frontend
cd ../frontend
npm install
npm run dev         # http://localhost:5173
```

## Week 2 exit criteria
- [x] Monorepo scaffold (frontend / api / risk-engine)
- [x] Postgres schema + migration script
- [x] Redis caching layer
- [x] CoinGecko price service with rate-limit-aware caching (`GET /api/prices`)
- [x] Etherscan wallet balance spike (`GET /api/wallets/:address/balance`)
- [x] JWT auth (`POST /api/auth/register`, `POST /api/auth/login`)
- [ ] Deploy skeleton (Vercel + Render) — end of week

## Smoke test
```bash
curl "http://localhost:4000/api/prices?ids=bitcoin,ethereum"
curl -X POST http://localhost:4000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"me@test.com","password":"secret123"}'
```
