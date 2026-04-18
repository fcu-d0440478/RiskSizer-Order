from decimal import Decimal, ROUND_CEILING, ROUND_DOWN


def to_decimal(value: object) -> Decimal:
    return Decimal(str(value))


def floor_to_step(value: Decimal, step: Decimal | None) -> Decimal:
    if step is None or step <= 0:
        return value
    units = (value / step).to_integral_value(rounding=ROUND_DOWN)
    return units * step


def quantize_by_precision(value: Decimal, precision: int | None) -> Decimal:
    if precision is None or precision < 0:
        return value
    quantum = Decimal("1").scaleb(-precision)
    return value.quantize(quantum)


def ceil_to_step(value: Decimal, step: Decimal | None) -> Decimal:
    if step is None or step <= 0:
        return value
    units = (value / step).to_integral_value(rounding=ROUND_CEILING)
    return units * step
