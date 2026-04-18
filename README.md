# RiskSizer

使用MEXC資料。輸入每單預計最大虧損 USDT 與止損價格，系統自動抓取目前市價，依照進場價與止損價的距離反推出建議總倉位，讓每筆交易打到止損時的虧損金額盡量接近你設定的固定 USDT。工具支援 MEXC 交易對搜尋、最新價格帶入、手動覆寫進場價，以及可選的止盈獲利估算，採用純前端 HTML、CSS、Vanilla JavaScript 製作。

## Features

- Search MEXC spot trading pairs from `exchangeInfo`
- Auto-fill `entry price` from the latest ticker price
- Manual entry price override
- `Use latest price` button
- LONG and SHORT validation
- Fixed risk-based position sizing
- `0.98` buffer to reduce slippage risk
- Optional take-profit input with estimated profit in USDT
- No backend required

## Inputs

- `side`: `LONG` or `SHORT`
- `risk USDT`
- `entry price`
- `stop loss price`
- `take profit price` (optional)

## Formula

```text
distance = abs(entry - stop)
raw_position_usdt = risk * entry / distance
position_usdt = raw_position_usdt * 0.98
qty = position_usdt / entry
estimated_loss = risk
estimated_profit =
  LONG  => (takeProfit - entry) * qty
  SHORT => (entry - takeProfit) * qty
```

## Validation

- LONG: `stop < entry`
- SHORT: `stop > entry`
- `distance` cannot be `0`
- LONG with take profit: `takeProfit > entry`
- SHORT with take profit: `takeProfit < entry`

## Local Use

1. Download or clone this repository.
2. Open `index.html` in a browser.

If the MEXC pair list cannot be loaded because of browser CORS restrictions, you can still type a full symbol like `TAOUSDT` and click `使用最新價格`.

## Files

- [index.html](index.html)
- [style.css](style.css)
- [app.js](app.js)

## Notes

- This project uses public MEXC API endpoints via `fetch`.
- Browser access to exchange APIs can be affected by CORS policies.
- The app includes fallback proxy and local cache logic, but third-party proxy availability can still change over time.
