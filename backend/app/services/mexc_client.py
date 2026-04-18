import hashlib
import hmac
import json
import time
from collections.abc import Mapping
from decimal import Decimal

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.models.market import MarketPriceResponse, MarketSymbol
from app.utils.decimals import floor_to_step, quantize_by_precision, to_decimal


class MexcClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.spot_base_url = settings.mexc_spot_base_url.rstrip("/")
        self.futures_base_url = settings.mexc_futures_base_url.rstrip("/")

    async def fetch_symbols(self) -> list[MarketSymbol]:
        spot_payload = await self._public_request(self.spot_base_url, "GET", "/api/v3/exchangeInfo")
        contract_catalog = await self._fetch_contract_catalog()
        items = spot_payload.get("symbols", [])
        results: list[MarketSymbol] = []

        for item in items:
            status_value = str(item.get("status", ""))
            if status_value not in {"1", "ENABLED", "TRADING"}:
                continue

            spot_symbol = item["symbol"]
            contract_meta = contract_catalog.get(_spot_to_contract_symbol(spot_symbol))

            results.append(
                MarketSymbol(
                    symbol=spot_symbol,
                    display_name=f"{item.get('baseAsset', '')}/{item.get('quoteAsset', '')}",
                    base_asset=item.get("baseAsset", ""),
                    quote_asset=item.get("quoteAsset", ""),
                    settle_asset=contract_meta.settle_asset if contract_meta else item.get("quoteAsset", ""),
                    status=status_value,
                    contract_symbol=contract_meta.symbol if contract_meta else None,
                    contract_available=contract_meta is not None,
                    contract_size=contract_meta.contract_size if contract_meta else None,
                    min_leverage=contract_meta.min_leverage if contract_meta else None,
                    max_leverage=contract_meta.max_leverage if contract_meta else None,
                    price_scale=contract_meta.price_scale if contract_meta else None,
                    vol_scale=contract_meta.vol_scale if contract_meta else None,
                    min_vol=contract_meta.min_vol if contract_meta else None,
                    max_vol=contract_meta.max_vol if contract_meta else None,
                    price_unit=contract_meta.price_unit if contract_meta else None,
                    vol_unit=contract_meta.vol_unit if contract_meta else None,
                    position_open_type=contract_meta.position_open_type if contract_meta else None,
                    api_allowed=contract_meta.api_allowed if contract_meta else False,
                )
            )

        return results

    async def fetch_price(self, symbol: str) -> MarketPriceResponse:
        normalized = symbol.upper()
        contract_catalog = await self._fetch_contract_catalog()

        if normalized in contract_catalog:
            return await self._fetch_contract_price(normalized, request_symbol=symbol)

        contract_symbol = _spot_to_contract_symbol(normalized)
        if contract_symbol in contract_catalog:
            return await self._fetch_contract_price(contract_symbol, request_symbol=symbol)

        return await self._fetch_spot_price(normalized, request_symbol=symbol)

    async def resolve_contract_symbol(self, symbol: str) -> MarketSymbol:
        normalized = symbol.upper()
        contract_catalog = await self._fetch_contract_catalog()

        if normalized in contract_catalog:
            return contract_catalog[normalized]

        contract_symbol = _spot_to_contract_symbol(normalized)
        if contract_symbol in contract_catalog:
            return contract_catalog[contract_symbol]

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No contract symbol is available for '{symbol}'.",
        )

    async def set_max_leverage(self, symbol_meta: MarketSymbol, requested_side: str) -> int:
        leverage = symbol_meta.max_leverage or 1
        if self.settings.mexc_order_test_mode:
            return leverage

        payload = {
            "openType": 2,
            "symbol": symbol_meta.symbol,
            "positionType": 1 if requested_side == "LONG" else 2,
            "leverage": leverage,
        }
        await self._private_request("POST", "/api/v1/private/position/change_leverage", body=payload)
        return leverage

    async def place_contract_order(
        self,
        symbol_meta: MarketSymbol,
        requested_side: str,
        leverage: int,
        market_price: Decimal,
        volume: Decimal,
        stop_loss_price: Decimal,
    ) -> tuple[int, Decimal, dict]:
        exchange_side = 1 if requested_side == "LONG" else 3
        rounded_price = quantize_by_precision(market_price, symbol_meta.price_scale)
        rounded_volume = floor_to_step(volume, symbol_meta.vol_unit)
        rounded_volume = quantize_by_precision(rounded_volume, symbol_meta.vol_scale)

        if symbol_meta.min_vol is not None and rounded_volume < symbol_meta.min_vol:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Calculated contract volume {rounded_volume} is below the exchange minimum "
                    f"{symbol_meta.min_vol} for {symbol_meta.symbol}."
                ),
            )

        if symbol_meta.max_vol and symbol_meta.max_vol > 0 and rounded_volume > symbol_meta.max_vol:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Calculated contract volume {rounded_volume} exceeds the exchange maximum "
                    f"{symbol_meta.max_vol} for {symbol_meta.symbol}."
                ),
            )

        body = {
            "symbol": symbol_meta.symbol,
            "price": float(rounded_price),
            "vol": float(rounded_volume),
            "leverage": leverage,
            "side": exchange_side,
            "type": 5,
            "openType": 2,
            "stopLossPrice": float(stop_loss_price),
        }

        if self.settings.mexc_order_test_mode:
            return exchange_side, rounded_volume, {
                "success": True,
                "code": 0,
                "data": {
                    "mode": "test",
                    "submitted_body": body,
                },
            }

        response = await self._private_request("POST", "/api/v1/private/order/create", body=body)
        return exchange_side, rounded_volume, response

    async def place_take_profit_limit_order(
        self,
        symbol_meta: MarketSymbol,
        requested_side: str,
        leverage: int,
        volume: Decimal,
        take_profit_price: Decimal,
    ) -> dict:
        close_side = 4 if requested_side == "LONG" else 2
        rounded_price = quantize_by_precision(take_profit_price, symbol_meta.price_scale)
        rounded_volume = floor_to_step(volume, symbol_meta.vol_unit)
        rounded_volume = quantize_by_precision(rounded_volume, symbol_meta.vol_scale)

        if self.settings.mexc_order_test_mode:
            return {
                "success": True,
                "code": 0,
                "data": {
                    "mode": "test",
                    "submitted_body": {
                        "symbol": symbol_meta.symbol,
                        "price": float(rounded_price),
                        "vol": float(rounded_volume),
                        "leverage": leverage,
                        "side": close_side,
                        "type": 1,
                        "openType": 2,
                        "reduceOnly": True,
                    },
                },
            }

        body = {
            "symbol": symbol_meta.symbol,
            "price": float(rounded_price),
            "vol": float(rounded_volume),
            "leverage": leverage,
            "side": close_side,
            "type": 1,
            "openType": 2,
            "reduceOnly": True,
        }
        return await self._private_request("POST", "/api/v1/private/order/create", body=body)

    async def _fetch_contract_catalog(self) -> dict[str, MarketSymbol]:
        payload = await self._public_request(self.futures_base_url, "GET", "/api/v1/contract/detail")
        items = payload.get("data", [])
        catalog: dict[str, MarketSymbol] = {}

        for item in items:
            if int(item.get("state", -1)) != 0:
                continue
            if str(item.get("settleCoin", "")).upper() != "USDT":
                continue

            contract_symbol = item["symbol"]
            base_asset, quote_asset = contract_symbol.split("_", 1) if "_" in contract_symbol else (contract_symbol, "")
            catalog[contract_symbol] = MarketSymbol(
                symbol=contract_symbol,
                display_name=item.get("displayNameEn") or contract_symbol,
                base_asset=base_asset,
                quote_asset=quote_asset,
                settle_asset=item.get("settleCoin", quote_asset),
                status="ENABLED",
                contract_symbol=contract_symbol,
                contract_available=True,
                contract_size=to_decimal(item.get("contractSize", "1")),
                min_leverage=int(item.get("minLeverage", 1)),
                max_leverage=int(item.get("maxLeverage", 1)),
                price_scale=int(item.get("priceScale", 0)),
                vol_scale=int(item.get("volScale", 0)),
                min_vol=to_decimal(item.get("minVol", "0")),
                max_vol=to_decimal(item.get("maxVol", "0")),
                price_unit=to_decimal(item.get("priceUnit", "0.01")),
                vol_unit=to_decimal(item.get("volUnit", "1")),
                position_open_type=int(item.get("positionOpenType", 0)),
                api_allowed=bool(item.get("apiAllowed", True)),
            )

        return catalog

    async def _fetch_contract_price(self, contract_symbol: str, request_symbol: str) -> MarketPriceResponse:
        payload = await self._public_request(
            self.futures_base_url,
            "GET",
            "/api/v1/contract/ticker",
            params={"symbol": contract_symbol},
        )
        data = payload.get("data") or {}
        return MarketPriceResponse(
            symbol=data["symbol"],
            request_symbol=request_symbol.upper(),
            market_type="contract",
            last_price=to_decimal(data["lastPrice"]),
            bid1=_decimal_or_none(data.get("bid1")),
            ask1=_decimal_or_none(data.get("ask1")),
            fair_price=_decimal_or_none(data.get("fairPrice")),
            index_price=_decimal_or_none(data.get("indexPrice")),
            funding_rate=_decimal_or_none(data.get("fundingRate")),
            timestamp=data.get("timestamp"),
        )

    async def _fetch_spot_price(self, spot_symbol: str, request_symbol: str) -> MarketPriceResponse:
        payload = await self._public_request(
            self.spot_base_url,
            "GET",
            "/api/v3/ticker/price",
            params={"symbol": spot_symbol},
        )
        return MarketPriceResponse(
            symbol=payload["symbol"],
            request_symbol=request_symbol.upper(),
            market_type="spot",
            last_price=to_decimal(payload["price"]),
        )

    async def _public_request(
        self,
        base_url: str,
        method: str,
        path: str,
        params: Mapping[str, str] | None = None,
    ) -> dict:
        return await self._request(base_url=base_url, method=method, path=path, params=params, headers={})

    async def _private_request(
        self,
        method: str,
        path: str,
        body: Mapping[str, object] | None = None,
    ) -> dict:
        if not self.settings.mexc_api_key or not self.settings.mexc_api_secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="MEXC credentials are missing. Set MEXC_API_KEY and MEXC_API_SECRET first.",
            )

        request_time = str(int(time.time() * 1000))
        serialized_body = json.dumps(body or {}, separators=(",", ":"), ensure_ascii=False)
        signature = hmac.new(
            self.settings.mexc_api_secret.encode("utf-8"),
            f"{self.settings.mexc_api_key}{request_time}{serialized_body}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        headers = {
            "ApiKey": self.settings.mexc_api_key,
            "Request-Time": request_time,
            "Signature": signature,
            "Recv-Window": str(self.settings.mexc_recv_window),
            "Content-Type": "application/json",
        }
        return await self._request(
            base_url=self.futures_base_url,
            method=method,
            path=path,
            headers=headers,
            json_body=body or {},
        )

    async def _request(
        self,
        base_url: str,
        method: str,
        path: str,
        headers: Mapping[str, str],
        params: Mapping[str, str] | None = None,
        json_body: Mapping[str, object] | None = None,
    ) -> dict:
        try:
            async with httpx.AsyncClient(base_url=base_url, timeout=10.0) as client:
                response = await client.request(
                    method,
                    path,
                    params=params,
                    headers=headers,
                    json=json_body,
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            api_name = "MEXC futures API" if base_url == self.futures_base_url else "MEXC spot API"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"{api_name} error: {exc.response.text}",
            ) from exc
        except httpx.HTTPError as exc:
            api_name = "MEXC futures API" if base_url == self.futures_base_url else "MEXC spot API"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Unable to reach {api_name}: {exc}",
            ) from exc

        payload = response.json()
        if isinstance(payload, dict) and payload.get("success") is False:
            message = payload.get("message") or f"code={payload.get('code')}"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"MEXC futures API rejected the request: {message}",
            )
        return payload


def _decimal_or_none(value: object) -> Decimal | None:
    if value in (None, ""):
        return None
    return to_decimal(value)


def _spot_to_contract_symbol(spot_symbol: str) -> str:
    symbol = spot_symbol.upper()
    if symbol.endswith("USDT"):
        return f"{symbol[:-4]}_USDT"
    return symbol
