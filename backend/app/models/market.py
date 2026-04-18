from decimal import Decimal

from pydantic import BaseModel


class MarketSymbol(BaseModel):
    symbol: str
    display_name: str
    base_asset: str
    quote_asset: str
    settle_asset: str | None = None
    status: str
    contract_symbol: str | None = None
    contract_available: bool = False
    contract_size: Decimal | None = None
    min_leverage: int | None = None
    max_leverage: int | None = None
    price_scale: int | None = None
    vol_scale: int | None = None
    min_vol: Decimal | None = None
    max_vol: Decimal | None = None
    price_unit: Decimal | None = None
    vol_unit: Decimal | None = None
    position_open_type: int | None = None
    api_allowed: bool = False


class MarketPriceResponse(BaseModel):
    symbol: str
    request_symbol: str
    market_type: str
    last_price: Decimal
    bid1: Decimal | None = None
    ask1: Decimal | None = None
    fair_price: Decimal | None = None
    index_price: Decimal | None = None
    funding_rate: Decimal | None = None
    timestamp: int | None = None
