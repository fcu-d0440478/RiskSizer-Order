from functools import lru_cache
from pathlib import Path

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "RiskSizer Order API"
    app_version: str = "2.1.0"
    mexc_spot_base_url: str = "https://api.mexc.com"
    mexc_futures_base_url: str = "https://api.mexc.com"
    mexc_api_key: str = ""
    mexc_api_secret: str = ""
    mexc_recv_window: int = 5000
    mexc_order_test_mode: bool = True
    position_buffer: float = 0.98
    allowed_origins_raw: str = (
        "http://127.0.0.1:4173,"
        "http://localhost:4173,"
        "http://127.0.0.1:5500,"
        "http://localhost:5500"
    )

    @computed_field
    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins_raw.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
