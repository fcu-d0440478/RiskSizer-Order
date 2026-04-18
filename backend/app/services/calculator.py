from decimal import Decimal

from fastapi import HTTPException, status

from app.models.calc import PositionCalcRequest, PositionCalcResponse, TradeSide


def _raise_validation_error(message: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message)


def calculate_position(payload: PositionCalcRequest, buffer_applied: Decimal) -> PositionCalcResponse:
    entry = payload.entry_price
    stop = payload.stop_loss_price
    side = payload.side

    distance = abs(entry - stop)
    if distance == 0:
        _raise_validation_error("Entry price and stop loss price cannot be the same.")

    if side == TradeSide.LONG and stop >= entry:
        _raise_validation_error("LONG orders require stop_loss_price to be lower than entry_price.")

    if side == TradeSide.SHORT and stop <= entry:
        _raise_validation_error("SHORT orders require stop_loss_price to be higher than entry_price.")

    take_profit = payload.take_profit_price
    if take_profit is not None:
        if side == TradeSide.LONG and take_profit <= entry:
            _raise_validation_error("LONG orders require take_profit_price to be higher than entry_price.")
        if side == TradeSide.SHORT and take_profit >= entry:
            _raise_validation_error("SHORT orders require take_profit_price to be lower than entry_price.")

    raw_position_usdt = (payload.risk_usdt * entry) / distance
    position_usdt = raw_position_usdt * buffer_applied
    qty = position_usdt / entry

    estimated_profit = None
    if take_profit is not None:
        if side == TradeSide.LONG:
            estimated_profit = qty * (take_profit - entry)
        else:
            estimated_profit = qty * (entry - take_profit)

    return PositionCalcResponse(
        side=side,
        risk_usdt=payload.risk_usdt,
        entry_price=entry,
        stop_loss_price=stop,
        take_profit_price=take_profit,
        distance=distance,
        position_usdt=position_usdt,
        qty=qty,
        estimated_loss=payload.risk_usdt,
        estimated_profit=estimated_profit,
        buffer_applied=buffer_applied,
    )


def calculate_contract_volume(position_usdt: Decimal, entry_price: Decimal, contract_size: Decimal) -> Decimal:
    if entry_price <= 0 or contract_size <= 0:
        _raise_validation_error("Entry price and contract size must be greater than zero.")
    return position_usdt / (entry_price * contract_size)
