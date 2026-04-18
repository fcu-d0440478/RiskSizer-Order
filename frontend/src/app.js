import { calculatePosition, getHealth, getPrice, getSymbols, placeOrder } from "./api.js";
import { formatFixed, formatNumber, normalizeSearchText } from "./format.js";
import { state } from "./state.js";

const elements = {
  symbolSearch: document.getElementById("symbolSearch"),
  symbolResults: document.getElementById("symbolResults"),
  selectedSymbolLabel: document.getElementById("selectedSymbolLabel"),
  side: document.getElementById("side"),
  riskUsdt: document.getElementById("riskUsdt"),
  entryPrice: document.getElementById("entryPrice"),
  stopPrice: document.getElementById("stopPrice"),
  takeProfitPrice: document.getElementById("takeProfitPrice"),
  latestPriceBtn: document.getElementById("latestPriceBtn"),
  refreshPairsBtn: document.getElementById("refreshPairsBtn"),
  placeOrderBtn: document.getElementById("placeOrderBtn"),
  statusMessage: document.getElementById("statusMessage"),
  orderResponse: document.getElementById("orderResponse"),
  healthStatus: document.getElementById("healthStatus"),
  healthDetail: document.getElementById("healthDetail"),
  orderMode: document.getElementById("orderMode"),
  positionUsdtValue: document.getElementById("positionUsdtValue"),
  qtyValue: document.getElementById("qtyValue"),
  entryValue: document.getElementById("entryValue"),
  stopValue: document.getElementById("stopValue"),
  distanceValue: document.getElementById("distanceValue"),
  lossValue: document.getElementById("lossValue"),
  profitValue: document.getElementById("profitValue"),
};

let calcDebounceId = null;

function updateOrderButtonState() {
  const contractReady = Boolean(state.selectedSymbol?.contract_available && state.currentCalc);
  elements.placeOrderBtn.disabled = !contractReady;
  elements.placeOrderBtn.textContent = state.selectedSymbol?.contract_available
    ? "Place Contract Order"
    : "Contract Unavailable";
}

function setStatus(message, tone = "neutral") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-pill ${tone}`;
}

function setOrderResponse(title, content) {
  elements.orderResponse.hidden = false;
  elements.orderResponse.innerHTML = `
    <strong>${title}</strong>
    <pre>${content}</pre>
  `;
}

function renderOrderSummary(payload) {
  const mainOrderTone = payload.main_order_success ? "success" : "error";
  const takeProfitStatus = payload.take_profit_limit_order
    ? `
      <div class="order-response-card">
        <span class="order-response-label">Take Profit Limit</span>
        <span class="order-response-value">${payload.take_profit_limit_order_message || "--"}</span>
        <span class="order-response-status ${payload.take_profit_limit_order_success ? "success" : "error"}">
          ${payload.take_profit_limit_order_success ? "Prepared / Submitted" : "Failed"}
        </span>
      </div>
    `
    : `
      <div class="order-response-card">
        <span class="order-response-label">Take Profit Limit</span>
        <span class="order-response-value">Not requested</span>
      </div>
    `;

  return `
    <strong>${payload.mode === "live" ? "Order Submitted" : "Dry Run Prepared"}</strong>
    <div class="order-response-grid">
      <div class="order-response-card">
        <span class="order-response-label">Main Order</span>
        <span class="order-response-value">${payload.main_order_message}</span>
        <span class="order-response-status ${mainOrderTone}">
          ${payload.main_order_success ? "Success" : "Failed"}
        </span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Main Order ID</span>
        <span class="order-response-value">${payload.main_order_id || "Not returned"}</span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Symbol / Side</span>
        <span class="order-response-value">${payload.symbol} / ${payload.requested_side}</span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Market Entry Price</span>
        <span class="order-response-value">${formatNumber(payload.market_entry_price, 8)}</span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Submitted Volume</span>
        <span class="order-response-value">${formatNumber(payload.submitted_volume, 8)}</span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Leverage / Margin</span>
        <span class="order-response-value">${payload.leverage_used}x / ${formatFixed(payload.estimated_margin_usdt, 4)} USDT</span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Stop Loss</span>
        <span class="order-response-value">${formatNumber(payload.stop_loss_price, 8)}</span>
      </div>
      ${takeProfitStatus}
      <div class="order-response-card">
        <span class="order-response-label">Take Profit Order ID</span>
        <span class="order-response-value">${payload.take_profit_limit_order_id || "Not returned"}</span>
      </div>
      <div class="order-response-card">
        <span class="order-response-label">Mode</span>
        <span class="order-response-value">${payload.mode.toUpperCase()}</span>
      </div>
    </div>
    <details class="order-response-details">
      <summary>Raw API payload</summary>
      <pre>${JSON.stringify(payload, null, 2)}</pre>
    </details>
  `;
}

function clearOrderResponse() {
  elements.orderResponse.hidden = true;
  elements.orderResponse.innerHTML = "";
}

function clearResults() {
  elements.positionUsdtValue.textContent = "--";
  elements.qtyValue.textContent = "--";
  elements.entryValue.textContent = "--";
  elements.stopValue.textContent = "--";
  elements.distanceValue.textContent = "--";
  elements.lossValue.textContent = "--";
  elements.profitValue.textContent = "--";
  state.currentCalc = null;
  updateOrderButtonState();
}

function renderCalculation(calc) {
  elements.positionUsdtValue.textContent = formatFixed(calc.position_usdt, 2);
  elements.qtyValue.textContent = formatFixed(calc.qty, 6);
  elements.entryValue.textContent = formatNumber(calc.entry_price, 8);
  elements.stopValue.textContent = formatNumber(calc.stop_loss_price, 8);
  elements.distanceValue.textContent = formatNumber(calc.distance, 8);
  elements.lossValue.textContent = formatFixed(calc.estimated_loss, 2);
  elements.profitValue.textContent =
    calc.estimated_profit === null ? "--" : formatFixed(calc.estimated_profit, 2);
}

function payloadFromInputs() {
  const riskUsdt = elements.riskUsdt.value.trim();
  const entryPrice = elements.entryPrice.value.trim();
  const stopPrice = elements.stopPrice.value.trim();
  const takeProfitPrice = elements.takeProfitPrice.value.trim();

  if (!riskUsdt || !entryPrice || !stopPrice) {
    return null;
  }

  return {
    side: elements.side.value,
    risk_usdt: riskUsdt,
    entry_price: entryPrice,
    stop_loss_price: stopPrice,
    take_profit_price: takeProfitPrice || null,
  };
}

function getSelectedSymbol() {
  if (state.selectedSymbol?.symbol) {
    return state.selectedSymbol.symbol;
  }

  const typed = normalizeSearchText(elements.symbolSearch.value);
  if (!typed) {
    return "";
  }

  const exact = state.symbols.find((item) => normalizeSearchText(item.symbol) === typed);
  if (exact) {
    state.selectedSymbol = exact;
    elements.selectedSymbolLabel.textContent = buildSelectedSymbolLabel(exact);
    return exact.symbol;
  }

  return typed;
}

function buildSelectedSymbolLabel(item) {
  if (!item) {
    return "No symbol selected";
  }

  if (item.contract_available) {
    return `${item.display_name} (${item.symbol}) -> ${item.contract_symbol} | max ${item.max_leverage}x`;
  }

  return `${item.display_name} (${item.symbol}) | no contract market`;
}

function scoreSymbolMatch(item, keyword) {
  const symbol = normalizeSearchText(item.symbol);
  const base = normalizeSearchText(item.base_asset);
  const quote = normalizeSearchText(item.quote_asset);

  if (symbol === keyword) return 1000;
  if (`${base}${quote}` === keyword) return 920;
  if (base === keyword) return 900;
  if (symbol.startsWith(keyword)) return 820;
  if (base.startsWith(keyword)) return 760;
  if (symbol.includes(keyword)) return 680;
  if (base.includes(keyword)) return 620;
  if (quote.includes(keyword)) return 560;
  return 0;
}

function renderSymbolResults(items) {
  if (!items.length) {
    elements.symbolResults.innerHTML = '<div class="result-item">No matching symbol</div>';
    elements.symbolResults.hidden = false;
    return;
  }

  elements.symbolResults.innerHTML = items
    .slice(0, 6)
    .map(
      (item) => {
        const contractLabel = item.contract_available
          ? `${item.contract_symbol} | max ${item.max_leverage}x`
          : "spot only | no contract";

        return `
        <button class="result-item" type="button" data-symbol="${item.symbol}">
          <span>
            <span class="result-main">${item.symbol}</span>
            <span class="result-sub">${item.display_name}</span>
          </span>
          <span class="result-sub">${contractLabel}</span>
        </button>
      `;
      }
    )
    .join("");
  elements.symbolResults.hidden = false;
}

function filterSymbols(keyword) {
  const normalized = normalizeSearchText(keyword);
  if (!normalized || normalized.length < 2) {
    state.filteredSymbols = [];
    elements.symbolResults.hidden = true;
    return;
  }

  state.filteredSymbols = state.symbols
    .map((item) => ({ item, score: scoreSymbolMatch(item, normalized) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.symbol.localeCompare(right.item.symbol);
    })
    .map((item) => item.item);

  renderSymbolResults(state.filteredSymbols);
}

function selectSymbol(symbolName) {
  const match = state.symbols.find((item) => item.symbol === symbolName);
  if (!match) {
    setStatus("Selected symbol is not available from the backend list.", "error");
    return;
  }

  state.selectedSymbol = match;
  elements.symbolSearch.value = match.symbol;
  elements.selectedSymbolLabel.textContent = buildSelectedSymbolLabel(match);
  elements.symbolResults.hidden = true;
  state.filteredSymbols = [];
  updateOrderButtonState();
  clearOrderResponse();
  void useLatestPrice();
}

async function refreshHealth() {
  try {
    const health = await getHealth();
    elements.healthStatus.textContent = health.status.toUpperCase();
    elements.healthDetail.textContent = health.credentials_configured
      ? "Credentials detected"
      : "Missing API credentials";
    elements.orderMode.textContent = health.order_test_mode ? "TEST" : "LIVE";
  } catch (error) {
    elements.healthStatus.textContent = "OFFLINE";
    elements.healthDetail.textContent = error.message;
    elements.orderMode.textContent = "--";
  }
}

async function loadSymbols() {
  setStatus("Loading MEXC symbols from backend...", "neutral");
  try {
    const payload = await getSymbols();
    state.symbols = payload.items || [];
    const contractEnabledCount = state.symbols.filter((item) => item.contract_available).length;
    setStatus(`Loaded ${state.symbols.length} symbols. ${contractEnabledCount} support contract orders.`, "success");
  } catch (error) {
    clearResults();
    setStatus(`Failed to load symbols: ${error.message}`, "error");
  }
}

async function useLatestPrice() {
  const symbol = getSelectedSymbol();
  if (!symbol) {
    setStatus("Select a symbol before fetching the latest price.", "error");
    return;
  }

  setStatus(`Fetching ${symbol} latest price...`, "neutral");
  try {
    const payload = await getPrice(symbol);
    elements.entryPrice.value = payload.last_price;
    if (!state.selectedSymbol) {
      elements.selectedSymbolLabel.textContent = `Manual symbol: ${payload.symbol}`;
    }
    const marketLabel = payload.market_type === "contract" ? "contract" : "spot";
    setStatus(`Latest ${marketLabel} price loaded for ${payload.symbol}.`, "success");
    scheduleCalculation();
  } catch (error) {
    setStatus(`Failed to fetch latest price: ${error.message}`, "error");
  }
}

async function runCalculation() {
  const payload = payloadFromInputs();
  clearOrderResponse();

  if (!payload) {
    clearResults();
    setStatus("Enter risk, entry price and stop loss to calculate.", "neutral");
    return;
  }

  const token = ++state.pendingCalcToken;
  setStatus("Calculating position...", "neutral");

  try {
    const calc = await calculatePosition(payload);
    if (token !== state.pendingCalcToken) {
      return;
    }
    state.currentCalc = calc;
    renderCalculation(calc);
    updateOrderButtonState();
    if (state.selectedSymbol?.contract_available) {
      setStatus("Calculation updated. Contract order is ready.", "success");
    } else if (state.selectedSymbol) {
      setStatus("Calculation updated, but this symbol has no supported contract market.", "neutral");
    } else {
      setStatus("Calculation updated.", "success");
    }
  } catch (error) {
    if (token !== state.pendingCalcToken) {
      return;
    }
    clearResults();
    setStatus(error.message, "error");
  }
}

function scheduleCalculation() {
  window.clearTimeout(calcDebounceId);
  calcDebounceId = window.setTimeout(() => {
    void runCalculation();
  }, 220);
}

async function submitOrder() {
  const symbol = getSelectedSymbol();
  const calcPayload = payloadFromInputs();

  if (!symbol) {
    setStatus("Select a symbol before placing an order.", "error");
    return;
  }

  if (!calcPayload || !state.currentCalc) {
    setStatus("Calculation must be valid before placing an order.", "error");
    return;
  }

  elements.placeOrderBtn.disabled = true;
  setStatus(`Submitting ${symbol} order...`, "neutral");

  try {
    const payload = await placeOrder({
      symbol: state.selectedSymbol?.contract_symbol || symbol,
      ...calcPayload,
    });

    elements.orderResponse.hidden = false;
    elements.orderResponse.innerHTML = renderOrderSummary(payload);
    const liveSuccess = payload.mode === "live" && payload.main_order_success;
    const dryRunSuccess = payload.mode === "test" && payload.main_order_success;
    if (liveSuccess) {
      setStatus(
        `${payload.symbol} main order submitted successfully.${payload.take_profit_limit_order_success ? " Take-profit limit order submitted too." : ""}`,
        "success"
      );
    } else if (dryRunSuccess) {
      setStatus(
        `${payload.symbol} dry-run prepared successfully. Review the summary below before enabling live mode.`,
        "success"
      );
    } else {
      setStatus("Order request returned without a success flag.", "error");
    }
  } catch (error) {
    setOrderResponse("Order failed", error.message);
    setStatus(`Order failed: ${error.message}`, "error");
  } finally {
    elements.placeOrderBtn.disabled = !state.currentCalc;
  }
}

function bindEvents() {
  elements.symbolSearch.addEventListener("input", (event) => {
    state.selectedSymbol = null;
    filterSymbols(event.target.value);
    updateOrderButtonState();
    clearOrderResponse();
  });

  elements.symbolSearch.addEventListener("focus", () => {
    if (elements.symbolSearch.value.trim().length >= 2) {
      filterSymbols(elements.symbolSearch.value);
    }
  });

  elements.symbolSearch.addEventListener("blur", () => {
    window.setTimeout(() => {
      elements.symbolResults.hidden = true;
    }, 120);
  });

  elements.symbolSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      elements.symbolResults.hidden = true;
      return;
    }

    if (event.key === "Tab") {
      elements.symbolResults.hidden = true;
      return;
    }

    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (!state.filteredSymbols.length) {
      filterSymbols(elements.symbolSearch.value);
    }
    if (state.filteredSymbols.length) {
      selectSymbol(state.filteredSymbols[0].symbol);
    }
  });

  elements.symbolResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-symbol]");
    if (button) {
      selectSymbol(button.dataset.symbol);
    }
  });

  document.addEventListener("click", (event) => {
    const insideSearch =
      event.target === elements.symbolSearch || elements.symbolResults.contains(event.target);
    if (!insideSearch) {
      elements.symbolResults.hidden = true;
    }
  });

  [elements.side, elements.riskUsdt, elements.entryPrice, elements.stopPrice, elements.takeProfitPrice].forEach(
    (element) => {
      element.addEventListener("input", scheduleCalculation);
    }
  );

  elements.latestPriceBtn.addEventListener("click", () => {
    clearOrderResponse();
    void useLatestPrice();
  });

  elements.refreshPairsBtn.addEventListener("click", () => {
    clearOrderResponse();
    void loadSymbols();
  });

  elements.placeOrderBtn.addEventListener("click", () => {
    clearOrderResponse();
    void submitOrder();
  });
}

async function init() {
  bindEvents();
  clearResults();
  updateOrderButtonState();
  await Promise.all([refreshHealth(), loadSymbols()]);
}

void init();
