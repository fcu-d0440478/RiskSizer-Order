from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class TradeSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class PositionCalcRequest(BaseModel):
    side: TradeSide
    risk_usdt: Decimal = Field(gt=0)
    entry_price: Decimal = Field(gt=0)
    stop_loss_price: Decimal = Field(gt=0)
    take_profit_price: Decimal | None = Field(default=None, gt=0)


class PositionCalcResponse(BaseModel):
    side: TradeSide
    risk_usdt: Decimal
    entry_price: Decimal
    stop_loss_price: Decimal
    take_profit_price: Decimal | None = None
    distance: Decimal
    position_usdt: Decimal
    qty: Decimal
    estimated_loss: Decimal
    estimated_profit: Decimal | None = None
    buffer_applied: Decimal
