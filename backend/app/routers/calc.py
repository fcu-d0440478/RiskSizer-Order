from decimal import Decimal

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.models.calc import PositionCalcRequest
from app.services.calculator import calculate_position

router = APIRouter(prefix="/calc", tags=["calc"])


@router.post("/position")
async def calc_position(
    payload: PositionCalcRequest,
    settings: Settings = Depends(get_settings),
):
    return calculate_position(payload, Decimal(str(settings.position_buffer)))
