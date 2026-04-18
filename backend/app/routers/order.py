from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.models.order import PlaceOrderRequest, PlaceOrderResponse
from app.services.calculator import calculate_contract_volume, calculate_position
from app.services.mexc_client import MexcClient

from .market import get_mexc_client

router = APIRouter(prefix="/order", tags=["order"])


@router.post("/place", response_model=PlaceOrderResponse)
async def place_order(
    payload: PlaceOrderRequest,
    client: MexcClient = Depends(get_mexc_client),
    settings: Settings = Depends(get_settings),
):
    symbol_key = payload.symbol.upper()
    symbol_meta = await client.resolve_contract_symbol(symbol_key)

    if symbol_meta.position_open_type not in {2, 3}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Symbol '{symbol_key}' does not support cross margin mode.",
        )
    if not symbol_meta.api_allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Symbol '{symbol_key}' is not marked as API-tradable by MEXC contract metadata.",
        )

    latest_ticker = await client.fetch_price(symbol_meta.symbol)
    runtime_payload = payload.model_copy(update={"entry_price": latest_ticker.last_price})
    calc = calculate_position(runtime_payload, Decimal(str(settings.position_buffer)))
    contracts = calculate_contract_volume(
        position_usdt=calc.position_usdt,
        entry_price=calc.entry_price,
        contract_size=symbol_meta.contract_size,
    )
    leverage = await client.set_max_leverage(symbol_meta, payload.side.value)
    exchange_side, submitted_volume, exchange_response = await client.place_contract_order(
        symbol_meta=symbol_meta,
        requested_side=payload.side.value,
        leverage=leverage,
        market_price=latest_ticker.last_price,
        volume=contracts,
        stop_loss_price=calc.stop_loss_price,
    )
    take_profit_limit_order = None
    if calc.take_profit_price is not None:
        take_profit_limit_order = await client.place_take_profit_limit_order(
            symbol_meta=symbol_meta,
            requested_side=payload.side.value,
            leverage=leverage,
            volume=submitted_volume,
            take_profit_price=calc.take_profit_price,
        )

    main_order_success = bool(exchange_response.get("success", False))
    main_order_message = (
        "Dry run prepared successfully."
        if settings.mexc_order_test_mode
        else "Main contract order submitted successfully."
    )
    main_order_id = _extract_order_id(exchange_response)

    take_profit_limit_order_success = None
    take_profit_limit_order_message = None
    take_profit_limit_order_id = None
    if take_profit_limit_order is not None:
        take_profit_limit_order_success = bool(take_profit_limit_order.get("success", False))
        take_profit_limit_order_message = (
            "Dry run prepared successfully."
            if settings.mexc_order_test_mode
            else "Take-profit limit order submitted successfully."
        )
        take_profit_limit_order_id = _extract_order_id(take_profit_limit_order)

    return PlaceOrderResponse(
        symbol=symbol_meta.symbol,
        requested_side=payload.side,
        exchange_side=exchange_side,
        mode="test" if settings.mexc_order_test_mode else "live",
        order_type="MARKET",
        main_order_success=main_order_success,
        main_order_message=main_order_message,
        main_order_id=main_order_id,
        leverage_used=leverage,
        market_entry_price=latest_ticker.last_price,
        contract_size=symbol_meta.contract_size,
        submitted_volume=submitted_volume,
        estimated_margin_usdt=calc.position_usdt / Decimal(leverage),
        stop_loss_price=calc.stop_loss_price,
        take_profit_limit_order_success=take_profit_limit_order_success,
        take_profit_limit_order_message=take_profit_limit_order_message,
        take_profit_limit_order_id=take_profit_limit_order_id,
        take_profit_limit_order=take_profit_limit_order,
        calc=calc,
        exchange_response=exchange_response,
    )


def _extract_order_id(payload: dict) -> str | None:
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("orderId", "order_id", "id"):
            value = data.get(key)
            if value not in (None, ""):
                return str(value)
    return None
