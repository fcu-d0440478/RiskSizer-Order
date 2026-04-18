const MEXC_EXCHANGE_INFO_URL = "https://api.mexc.com/api/v3/exchangeInfo";
const MEXC_TICKER_PRICE_URL = "https://api.mexc.com/api/v3/ticker/price";
const POSITION_BUFFER = 0.98;
const SYMBOL_CACHE_KEY = "riskSizer.mexc.exchangeInfo";
const REQUEST_TIMEOUT_MS = 8000;
const CORS_PROXIES = [
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://cors.isomorphic-git.org/${url}`,
];

const state = {
  symbols: [],
  filteredSymbols: [],
  selectedSymbol: null,
};

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
  statusMessage: document.getElementById("statusMessage"),
  entryValue: document.getElementById("entryValue"),
  stopValue: document.getElementById("stopValue"),
  distanceValue: document.getElementById("distanceValue"),
  positionUsdtValue: document.getElementById("positionUsdtValue"),
  qtyValue: document.getElementById("qtyValue"),
  lossValue: document.getElementById("lossValue"),
  profitValue: document.getElementById("profitValue"),
};

function setStatus(message, tone = "neutral") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-pill ${tone}`;
}

function formatNumber(value, digits = 8) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatFixed(value, digits) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Number(value).toFixed(digits);
}

function readSymbolCache() {
  try {
    const raw = localStorage.getItem(SYMBOL_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.symbols) || !parsed.symbols.length) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function writeSymbolCache(symbols) {
  try {
    localStorage.setItem(
      SYMBOL_CACHE_KEY,
      JSON.stringify({
        updatedAt: Date.now(),
        symbols,
      })
    );
  } catch (error) {
    console.error(error);
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function requestJson(url) {
  const targets = [url, ...CORS_PROXIES.map((buildUrl) => buildUrl(url))];
  let lastError = null;

  for (const target of targets) {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(target, {
        signal: controller.signal,
        cache: "no-store",
      });
      window.clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("request failed");
}

function renderSymbolResults(items) {
  const container = elements.symbolResults;

  if (!items.length) {
    container.innerHTML = '<div class="result-item" aria-disabled="true">找不到符合的交易對</div>';
    container.hidden = false;
    return;
  }

  container.innerHTML = items
    .slice(0, 16)
    .map(
      (item) => `
        <button class="result-item" type="button" data-symbol="${item.symbol}">
          <span>
            <span class="result-main">${item.symbol}</span>
            <span class="result-sub">${item.baseAsset} / ${item.quoteAsset}</span>
          </span>
          <span class="result-sub">${item.status}</span>
        </button>
      `
    )
    .join("");

  container.hidden = false;
}

function clearResultsPanel() {
  elements.entryValue.textContent = "--";
  elements.stopValue.textContent = "--";
  elements.distanceValue.textContent = "--";
  elements.positionUsdtValue.textContent = "--";
  elements.qtyValue.textContent = "--";
  elements.lossValue.textContent = "--";
  elements.profitValue.textContent = "--";
}

function getSymbolInputValue() {
  return normalizeSearchText(elements.symbolSearch.value);
}

function resolveSymbolForPrice() {
  if (state.selectedSymbol?.symbol) {
    return state.selectedSymbol.symbol;
  }

  const typedValue = getSymbolInputValue();
  if (!typedValue) {
    return "";
  }

  const exactMatch = state.symbols.find((item) => normalizeSearchText(item.symbol) === typedValue);
  if (exactMatch) {
    state.selectedSymbol = exactMatch;
    elements.selectedSymbolLabel.textContent = `${exactMatch.baseAsset} / ${exactMatch.quoteAsset} (${exactMatch.symbol})`;
    return exactMatch.symbol;
  }

  return typedValue;
}

function scoreSymbolMatch(item, keyword) {
  const symbol = normalizeSearchText(item.symbol);
  const base = normalizeSearchText(item.baseAsset);
  const quote = normalizeSearchText(item.quoteAsset);
  const fullName = normalizeSearchText(item.fullName);
  const combined = `${symbol}${base}${quote}${fullName}`;

  if (symbol === keyword) return 1000;
  if (`${base}${quote}` === keyword) return 950;
  if (base === keyword) return 900;
  if (symbol.startsWith(keyword)) return 800;
  if (`${base}${quote}`.startsWith(keyword)) return 760;
  if (base.startsWith(keyword)) return 720;
  if (fullName.startsWith(keyword)) return 680;
  if (symbol.includes(keyword)) return 620;
  if (base.includes(keyword)) return 580;
  if (quote.includes(keyword)) return 540;
  if (fullName.includes(keyword)) return 500;
  if (combined.includes(keyword)) return 420;

  return 0;
}

function updateResults() {
  const side = elements.side.value;
  const risk = Number(elements.riskUsdt.value);
  const entry = Number(elements.entryPrice.value);
  const stop = Number(elements.stopPrice.value);
  const takeProfitRaw = elements.takeProfitPrice.value.trim();
  const takeProfit = takeProfitRaw === "" ? null : Number(takeProfitRaw);

  if (!Number.isFinite(risk) || risk <= 0) {
    clearResultsPanel();
    setStatus("Risk USDT 必須大於 0", "error");
    return;
  }

  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || stop <= 0) {
    clearResultsPanel();
    setStatus("請輸入有效的 entry 與 stop 價格", "neutral");
    return;
  }

  const distance = Math.abs(entry - stop);

  if (distance === 0) {
    clearResultsPanel();
    setStatus("Distance 不能為 0", "error");
    return;
  }

  if (side === "LONG" && stop >= entry) {
    clearResultsPanel();
    setStatus("LONG 條件下 stop 必須小於 entry", "error");
    return;
  }

  if (side === "SHORT" && stop <= entry) {
    clearResultsPanel();
    setStatus("SHORT 條件下 stop 必須大於 entry", "error");
    return;
  }

  if (takeProfit !== null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      clearResultsPanel();
      setStatus("Take profit price 必須是有效正數", "error");
      return;
    }

    if (side === "LONG" && takeProfit <= entry) {
      clearResultsPanel();
      setStatus("LONG 條件下 take profit 必須大於 entry", "error");
      return;
    }

    if (side === "SHORT" && takeProfit >= entry) {
      clearResultsPanel();
      setStatus("SHORT 條件下 take profit 必須小於 entry", "error");
      return;
    }
  }

  const rawPositionUsdt = (risk * entry) / distance;
  const positionUsdt = rawPositionUsdt * POSITION_BUFFER;
  const qty = positionUsdt / entry;
  const estimatedProfit =
    takeProfit === null
      ? null
      : side === "LONG"
        ? qty * (takeProfit - entry)
        : qty * (entry - takeProfit);

  elements.entryValue.textContent = formatNumber(entry, 8);
  elements.stopValue.textContent = formatNumber(stop, 8);
  elements.distanceValue.textContent = formatNumber(distance, 8);
  elements.positionUsdtValue.textContent = formatFixed(positionUsdt, 2);
  elements.qtyValue.textContent = formatFixed(qty, 4);
  elements.lossValue.textContent = formatFixed(risk, 2);
  elements.profitValue.textContent = estimatedProfit === null ? "--" : formatFixed(estimatedProfit, 2);

  setStatus("計算完成", "success");
}

async function fetchExchangeInfo() {
  setStatus("載入 MEXC 交易對中...", "neutral");

  const data = await requestJson(MEXC_EXCHANGE_INFO_URL);
  state.symbols = (data.symbols || []).filter((item) => item.status === "1" || item.status === "ENABLED");
  state.filteredSymbols = state.symbols;
  writeSymbolCache(state.symbols);
  setStatus(`已載入 ${state.symbols.length} 個交易對`, "success");
}

async function fetchLatestPrice(symbol) {
  const data = await requestJson(`${MEXC_TICKER_PRICE_URL}?symbol=${encodeURIComponent(symbol)}`);
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("invalid ticker price");
  }

  return price;
}

async function useLatestPrice() {
  const symbol = resolveSymbolForPrice();

  if (!symbol) {
    setStatus("請先選取或輸入交易對", "error");
    return;
  }

  setStatus(`抓取 ${symbol} 最新價格...`, "neutral");

  try {
    const price = await fetchLatestPrice(symbol);
    elements.entryPrice.value = price;
    elements.symbolSearch.value = symbol;
    if (!state.selectedSymbol) {
      elements.selectedSymbolLabel.textContent = `直接輸入交易對: ${symbol}`;
    }
    setStatus(`已更新 ${symbol} 最新價格`, "success");
    updateResults();
  } catch (error) {
    console.error(error);
    setStatus("抓取最新價格失敗，請稍後再試", "error");
  }
}

function selectSymbol(symbolName) {
  const match = state.symbols.find((item) => item.symbol === symbolName);
  if (!match) {
    setStatus("找不到該交易對", "error");
    return;
  }

  state.selectedSymbol = match;
  elements.symbolSearch.value = match.symbol;
  elements.selectedSymbolLabel.textContent = `${match.baseAsset} / ${match.quoteAsset} (${match.symbol})`;
  elements.symbolResults.hidden = true;
  useLatestPrice();
}

function filterSymbols(keyword) {
  const normalized = normalizeSearchText(keyword);

  if (!normalized) {
    state.filteredSymbols = [];
    elements.symbolResults.hidden = true;
    return;
  }

  const matches = state.symbols
    .map((item) => ({
      item,
      score: scoreSymbolMatch(item, normalized),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.symbol.localeCompare(right.item.symbol);
    })
    .map(({ item }) => item);

  state.filteredSymbols = matches;
  renderSymbolResults(matches);
}

function bindEvents() {
  elements.symbolSearch.addEventListener("input", (event) => {
    filterSymbols(event.target.value);
  });

  elements.symbolSearch.addEventListener("focus", () => {
    if (elements.symbolSearch.value.trim()) {
      filterSymbols(elements.symbolSearch.value);
    }
  });

  elements.symbolSearch.addEventListener("keydown", (event) => {
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
    if (!button) {
      return;
    }
    selectSymbol(button.dataset.symbol);
  });

  document.addEventListener("click", (event) => {
    const isSearchArea =
      event.target === elements.symbolSearch || elements.symbolResults.contains(event.target);
    if (!isSearchArea) {
      elements.symbolResults.hidden = true;
    }
  });

  [elements.side, elements.riskUsdt, elements.entryPrice, elements.stopPrice, elements.takeProfitPrice].forEach((element) => {
    element.addEventListener("input", updateResults);
  });

  elements.latestPriceBtn.addEventListener("click", useLatestPrice);
  elements.refreshPairsBtn.addEventListener("click", initializeSymbols);
}

async function initializeSymbols() {
  try {
    await fetchExchangeInfo();
  } catch (error) {
    console.error(error);
    const cached = readSymbolCache();
    if (cached) {
      state.symbols = cached.symbols;
      state.filteredSymbols = cached.symbols;
      const updatedAt = new Date(cached.updatedAt).toLocaleString("zh-TW");
      setStatus(`交易對清單載入失敗，已改用快取資料 (${updatedAt})`, "success");
      return;
    }

    setStatus("無法載入交易對清單；可直接輸入完整交易對，例如 TAOUSDT，再按使用最新價格", "error");
  }
}

function initializeApp() {
  bindEvents();
  clearResultsPanel();
  initializeSymbols();
}

initializeApp();
