from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.calc import PositionCalcRequest, PositionCalcResponse, TradeSide


class PlaceOrderRequest(PositionCalcRequest):
    symbol: str = Field(min_length=1)


class PlaceOrderResponse(BaseModel):
    symbol: str
    requested_side: TradeSide
    exchange_side: int
    mode: str
    order_type: str
    main_order_success: bool
    main_order_message: str
    main_order_id: str | None = None
    leverage_used: int
    market_entry_price: Decimal
    contract_size: Decimal
    submitted_volume: Decimal
    estimated_margin_usdt: Decimal
    stop_loss_price: Decimal
    take_profit_limit_order_success: bool | None = None
    take_profit_limit_order_message: str | None = None
    take_profit_limit_order_id: str | None = None
    take_profit_limit_order: dict | None = None
    calc: PositionCalcResponse
    exchange_response: dict
