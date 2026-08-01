# Pin anyio to asyncio only — system pytest/anyio also tries trio, which is not installed.
import pytest

@pytest.fixture
def anyio_backend():
    return "asyncio"
