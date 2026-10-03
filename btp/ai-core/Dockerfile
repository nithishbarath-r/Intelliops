# Serving image for SAP AI Core. Build, push to your registry, and register the
# registry secret in AI Core (see README.md).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY serve.py .
ENV MODEL_DIR=/mnt/models PORT=9001
EXPOSE 9001
CMD ["gunicorn", "--bind", "0.0.0.0:9001", "--workers", "2", "serve:app"]
