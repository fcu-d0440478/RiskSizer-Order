from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "order_test_mode": settings.mexc_order_test_mode,
        "credentials_configured": bool(settings.mexc_api_key and settings.mexc_api_secret),
        "dry_run_without_credentials": settings.mexc_order_test_mode,
    }
