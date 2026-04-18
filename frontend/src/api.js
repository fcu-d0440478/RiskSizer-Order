const API_BASE_URL =
  window.__RISK_SIZER_CONFIG__?.apiBaseUrl?.replace(/\/$/, "") || "http://127.0.0.1:8000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json();
      detail = payload.detail || JSON.stringify(payload);
    } catch (error) {
      detail = await response.text();
    }
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return response.json();
}

export function getHealth() {
  return request("/health");
}

export function getSymbols() {
  return request("/market/symbols");
}

export function getPrice(symbol) {
  const query = new URLSearchParams({ symbol });
  return request(`/market/price?${query.toString()}`);
}

export function calculatePosition(payload) {
  return request("/calc/position", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function placeOrder(payload) {
  return request("/order/place", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
