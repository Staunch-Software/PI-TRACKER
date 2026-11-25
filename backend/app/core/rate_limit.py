"""Thread-safe in-memory sliding-window rate limiter for authentication endpoints."""

from collections import defaultdict, deque
import math
import threading
import time

from fastapi import HTTPException, Request, status

LOGIN_WINDOW_SECONDS = 300  # 5 minutes
LOGIN_MAX_FAILURES_PER_ACCOUNT = 5
LOGIN_MAX_FAILURES_PER_IP = 15
CHANGE_PW_MAX_FAILURES = 5
_MAX_TRACKED_KEYS = 10_000


def get_client_ip(request: Request) -> str:
    """Resolve client IP, trusting Nginx proxy headers only when direct peer is loopback."""
    direct = request.client.host if request.client else ""
    if direct in ("127.0.0.1", "::1"):
        real_ip = (request.headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip
        forwarded = (request.headers.get("x-forwarded-for") or "").strip()
        if forwarded:
            return forwarded.split(",")[-1].strip()
    return direct or "unknown"


class SlidingWindowLimiter:
    """Thread-safe sliding-window tracker that counts failed auth attempts and enforces 429."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune_locked(self, key: str, now: float, window_seconds: int) -> deque[float]:
        cutoff = now - window_seconds
        q = self._failures[key]
        while q and q[0] <= cutoff:
            q.popleft()
        if not q:
            self._failures.pop(key, None)
        return q

    def check_or_raise(self, limits: list[tuple[str, int, int]], detail: str) -> None:
        now = time.monotonic()
        with self._lock:
            max_retry = 0
            for key, max_attempts, window_seconds in limits:
                if key not in self._failures:
                    continue
                q = self._prune_locked(key, now, window_seconds)
                if len(q) >= max_attempts:
                    retry_after = max(1, math.ceil((q[0] + window_seconds) - now))
                    max_retry = max(max_retry, retry_after)
            if max_retry > 0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=detail,
                    headers={"Retry-After": str(max_retry)},
                )

    def record_failure(self, keys: list[str], window_seconds: int) -> None:
        now = time.monotonic()
        with self._lock:
            if len(self._failures) >= _MAX_TRACKED_KEYS:
                for k in list(self._failures.keys()):
                    self._prune_locked(k, now, window_seconds)
            for key in keys:
                q = self._failures[key]
                cutoff = now - window_seconds
                while q and q[0] <= cutoff:
                    q.popleft()
                q.append(now)

    def reset(self, keys: list[str]) -> None:
        with self._lock:
            for key in keys:
                self._failures.pop(key, None)


auth_rate_limiter = SlidingWindowLimiter()
