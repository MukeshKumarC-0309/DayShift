# Backend container for hosting (Fly.io, Railway, Render, ...).
# The frontend is deployed separately to Netlify — see netlify.toml.
#
# Mount a persistent volume at /data. Without one, the database and your
# credentials are wiped on every redeploy.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    COOKIE_SECURE=true \
    PORT=8000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY backend ./backend

VOLUME ["/data"]
EXPOSE 8000

# --proxy-headers so client IPs and https are read from the Netlify proxy.
CMD ["sh", "-c", "uvicorn app:app --app-dir backend --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
