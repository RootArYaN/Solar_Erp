# syntax=docker/dockerfile:1.7

ARG PYTHON_IMAGE=python:3.12.13-slim-bookworm

FROM ${PYTHON_IMAGE} AS dependencies

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /build
COPY requirements.lock .
RUN python -m pip install --no-deps --requirement requirements.lock \
    && python -m pip check

FROM ${PYTHON_IMAGE} AS runtime

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONFAULTHANDLER=1 \
    PORT=8000 \
    WEB_CONCURRENCY=1 \
    FORWARDED_ALLOW_IPS=127.0.0.1 \
    STORAGE_TEMP_PATH=/tmp/solar-erp

RUN groupadd --system --gid 10001 solarerp \
    && useradd --system --uid 10001 --gid solarerp --home-dir /app --shell /usr/sbin/nologin solarerp \
    && mkdir -p /app/storage/active /tmp/solar-erp \
    && chown -R solarerp:solarerp /app /tmp/solar-erp

COPY --from=dependencies /opt/venv /opt/venv

WORKDIR /app
COPY --chown=solarerp:solarerp app ./app
COPY --chown=solarerp:solarerp scripts ./scripts

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "scripts/container_healthcheck.py"]

ENTRYPOINT ["scripts/start-production.sh"]
