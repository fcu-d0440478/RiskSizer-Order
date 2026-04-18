# RiskSizer Order

`RiskSizer Order` is the upgraded version of the original RiskSizer. It keeps the original risk-based position sizing workflow, but adds a FastAPI backend so API credentials stay server-side and MEXC Futures orders can be prepared or submitted from the backend.

## Version Difference

### How this differs from the original RiskSizer

- The original `RiskSizer` was a pure frontend tool. It only calculated position size, did not place orders, and was suitable for static hosting such as GitHub Pages.
- This version keeps the calculator, but adds a FastAPI backend for signing private requests, protecting API credentials, and placing MEXC Futures orders.
- Because credentials and signing now live on the server, deployment, security, and runtime requirements are different from the original static-only version.

## Current Architecture

### Frontend

- Static frontend in `frontend/`
- Searches spot symbols from backend-provided market data
- Fetches latest price for preview
- Calls backend calculator endpoint
- Shows a readable order summary instead of only raw JSON
- Sends the final contract order request to the backend

### Backend

- FastAPI app in `backend/`
- Serves `health`, `market`, `calc`, and `order` APIs
- Uses MEXC spot market data for symbol discovery
- Resolves a matching Futures contract symbol when available
- Re-fetches the newest Futures price at submit time
- Recalculates position size and contract volume right before order placement
- Uses max leverage in cross margin mode before opening a position
- Sends stop loss with the main order
- Optionally sends a separate reduce-only take-profit limit order

## Current Trading Flow

This project currently uses a mixed market-data flow:

- Symbol search is based on MEXC spot symbols such as `BTCUSDT`
- Order placement is based on the mapped MEXC Futures contract such as `BTC_USDT`

Example:

- Search input: `BTCUSDT`
- Resolved Futures contract: `BTC_USDT`

If a spot symbol does not have a supported contract market, the calculator still works, but the contract order button stays unavailable.

## Futures API Notes

The backend is aligned to the newer MEXC Futures documentation set:

- [Integration Guide](https://www.mexc.com/zh-MY/api-docs/futures/integration-guide)
- [Market Endpoints](https://www.mexc.com/zh-MY/api-docs/futures/market-endpoints)
- [Account and Trading Endpoints](https://www.mexc.com/zh-MY/api-docs/futures/account-and-trading-endpoints)
- [WebSocket API](https://www.mexc.com/zh-MY/api-docs/futures/websocket-api)

Current implementation assumptions:

- Spot base URL: `https://api.mexc.com`
- Futures base URL: `https://api.mexc.com`
- Futures private requests use:
  - `ApiKey`
  - `Request-Time`
  - `Signature`
  - `Recv-Window`
- POST signature target is:
  - `accessKey + timestamp + request-body-json`

## Formula

The original sizing formula is preserved:

```text
position_usdt = (risk_usdt * entry_price / abs(entry_price - stop_loss_price)) * 0.98
```

Derived values:

```text
distance = abs(entry_price - stop_loss_price)
qty = position_usdt / entry_price
estimated_loss = risk_usdt
estimated_profit =
  LONG  => qty * (take_profit_price - entry_price)
  SHORT => qty * (entry_price - take_profit_price)
```

When placing a contract order, backend converts that result into contract volume using the newest Futures market price:

```text
contract_vol = position_usdt / (latest_market_price * contract_size)
```

## Validation Rules

- `LONG`: `stop_loss_price < entry_price`
- `SHORT`: `stop_loss_price > entry_price`
- `entry_price` and `stop_loss_price` cannot be equal
- If `take_profit_price` is provided:
- `LONG`: `take_profit_price > entry_price`
- `SHORT`: `take_profit_price < entry_price`

## Order Behavior

When `Place Contract Order` is clicked:

1. Backend resolves the Futures contract symbol from the selected symbol
2. Backend fetches the newest Futures market price again
3. Backend replaces preview `entry_price` with that newest price
4. Backend recalculates `position_usdt` and `contract_vol`
5. Backend sets leverage to the symbol max leverage
6. Backend opens the position in cross margin mode
7. Backend sends `stopLossPrice` with the main order
8. If take profit was entered, backend sends a separate reduce-only limit order

Important behavior:

- Manual `entry price` is only used for preview
- Real order sizing always uses the newest market price at submit time
- The project currently uses cross margin mode for opening positions

## API Endpoints

- `GET /api/health`
- `GET /api/market/symbols`
- `GET /api/market/price?symbol=BTCUSDT`
- `POST /api/calc/position`
- `POST /api/order/place`

## Project Structure

```text
RiskSizer-Order/
├─ .env.example
├─ .gitignore
├─ README.md
├─ start-dev.cmd
├─ start-dev.ps1
├─ backend/
│  ├─ requirements.txt
│  └─ app/
│     ├─ main.py
│     ├─ core/
│     ├─ models/
│     ├─ routers/
│     ├─ services/
│     └─ utils/
└─ frontend/
   ├─ index.html
   ├─ styles/
   └─ src/
```

## Environment Variables

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Example:

```env
MEXC_API_KEY=your_mexc_api_key
MEXC_API_SECRET=your_mexc_api_secret
MEXC_FUTURES_BASE_URL=https://api.mexc.com
MEXC_RECV_WINDOW=5000
MEXC_ORDER_TEST_MODE=true
POSITION_BUFFER=0.98
ALLOWED_ORIGINS_RAW=http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5500,http://localhost:5500
```

Notes:

- `MEXC_ORDER_TEST_MODE=true` enables dry-run order preparation
- In dry-run mode, backend still recalculates latest price and contract volume, but does not submit live private orders
- CORS origins are configured from `ALLOWED_ORIGINS_RAW`

## Installation

### First-time setup

Backend dependencies are installed once:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Daily start

Use the root startup script:

```powershell
.\start-dev.ps1
```

This opens:

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:4173`

You can also start them manually:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

```powershell
cd frontend
python -m http.server 4173
```

## How To Use

1. Start backend and frontend
2. Search a symbol such as `BTCUSDT`
3. Select a symbol from the search results
4. Click `Use Latest Price` or manually enter a preview entry price
5. Enter `Risk USDT` and `Stop Loss Price`
6. Optionally enter `Take Profit Price`
7. Review the calculator output
8. Click `Place Contract Order`
9. Review the order summary returned by backend

## Order Response Summary

Frontend currently shows a readable summary including:

- Main order success or failure
- Main order message
- Main order ID
- Symbol and side
- Market entry price used at submit time
- Submitted contract volume
- Leverage and estimated margin
- Stop loss
- Take-profit limit order status
- Take-profit order ID
- Mode: `TEST` or `LIVE`

The raw backend payload is still available in an expandable details block.

## Health Check

`GET /api/health` returns:

- app status
- API version
- whether order test mode is enabled
- whether credentials are configured
- whether dry-run is available without credentials

## Risk Warning

This is not only a calculator anymore. It can prepare or submit live Futures orders.

- If `MEXC_ORDER_TEST_MODE=false`, backend will call private Futures endpoints for real
- Final position size may differ from preview because latest market price is fetched again at submit time
- Exchange limits, leverage caps, precision rules, permissions, KYC requirements, IP binding, and network restrictions still apply
- Cross margin mode is currently used for opening positions

Recommended workflow:

1. Keep `MEXC_ORDER_TEST_MODE=true`
2. Verify latest price, contract volume, stop loss, and take-profit preview
3. Confirm API permissions and network access
4. Switch to live mode only after dry-run behavior looks correct
