from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    """Health check — used by Electron to know the API is ready."""
    return {"status": "ok"}
