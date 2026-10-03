"""
Inference server for SAP AI Core (KServe). Contract used by
btp/srv/adapters/aicore.js:

  POST /v1/predict
  { "instances": [ { "temperature": 9.2, "slopePerHour": 7.2, ... } ] }
  -> { "predictions": [ { "probability": 0.92, "level": "HIGH", "model": "..." } ] }
"""
import os

import joblib
from flask import Flask, jsonify, request

MODEL_DIR = os.environ.get("MODEL_DIR", "/mnt/models")
bundle = joblib.load(os.path.join(MODEL_DIR, "model.joblib"))
model, features, name = bundle["model"], bundle["features"], bundle["name"]

app = Flask(__name__)


def level(p):
    return "HIGH" if p >= 0.6 else "MEDIUM" if p >= 0.25 else "LOW"


@app.get("/v1/health")
def health():
    return jsonify(status="ok", model=name)


@app.post("/v1/predict")
def predict():
    instances = request.get_json(force=True).get("instances", [])
    rows = [[float(i.get(f, 0) or 0) for f in features] for i in instances]
    probs = model.predict_proba(rows)[:, 1] if rows else []
    return jsonify(predictions=[{"probability": round(float(p), 4), "level": level(p), "model": name} for p in probs])


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 9001)))
