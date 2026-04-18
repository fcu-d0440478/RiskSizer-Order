from fastapi import APIRouter, Depends, Query

from app.core.config import Settings, get_settings
from app.services.mexc_client import MexcClient

router = APIRouter(prefix="/market", tags=["market"])


def get_mexc_client(settings: Settings = Depends(get_settings)) -> MexcClient:
    return MexcClient(settings)


@router.get("/symbols")
async def get_symbols(client: MexcClient = Depends(get_mexc_client)):
    symbols = await client.fetch_symbols()
    return {"items": symbols}


@router.get("/price")
async def get_price(
    symbol: str = Query(min_length=1),
    client: MexcClient = Depends(get_mexc_client),
):
    return await client.fetch_price(symbol.upper())
