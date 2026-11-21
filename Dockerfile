FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Kuala_Lumpur

WORKDIR /app

COPY pyproject.toml ./
COPY imsc ./imsc
RUN pip install .

ENTRYPOINT ["imsc"]
CMD ["help"]
