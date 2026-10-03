"""
Train the 24-hour excursion-risk model for SAP AI Core.

Features match btp/srv/lib/risk-model.js exactly:
  temperature, slopePerHour, ambientTemp, stationaryMin,
  doorOpens1h, hoursRemaining, minutesAboveLimit

Until you have labelled history exported from HANA Cloud
(SensorReadings + Excursions), this generates a synthetic training set.
Swap `load_data()` for a HANA query (hana_ml / hdbcli) when real data exists.

    pip install -r requirements.txt
    python train.py            # writes model/model.joblib + model/metrics.json
"""
import json
import os

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

FEATURES = [
    "temperature",
    "slopePerHour",
    "ambientTemp",
    "stationaryMin",
    "doorOpens1h",
    "hoursRemaining",
    "minutesAboveLimit",
]


def load_data(n=20000, seed=7):
    rng = np.random.default_rng(seed)
    X = np.column_stack(
        [
            rng.normal(5.5, 1.6, n).clip(1, 14),      # temperature
            rng.normal(0.3, 1.8, n).clip(-4, 10),     # slope °C/h
            rng.normal(31, 3.5, n).clip(20, 44),      # outside air
            rng.exponential(8, n).clip(0, 180),       # minutes stationary
            rng.poisson(0.3, n),                      # door opens in last hour
            rng.uniform(0.2, 8, n),                   # hours remaining
            rng.exponential(3, n).clip(0, 120),       # minutes above limit
        ]
    )
    # Hidden "ground truth" used only to label synthetic data.
    z = (
        -5.5
        + 1.1 * (X[:, 0] - 6)
        + 0.35 * X[:, 1]
        + 0.08 * (X[:, 2] - 30)
        + 0.02 * X[:, 3]
        + 0.35 * X[:, 4]
        + 0.12 * X[:, 5]
        + 0.03 * X[:, 6]
        + rng.normal(0, 0.6, n)
    )
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-z))).astype(int)
    return X, y


def main():
    X, y = load_data()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    model = LogisticRegression(max_iter=1000)
    model.fit(X_train, y_train)
    auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])

    out_dir = os.environ.get("OUTPUT_PATH", "model")
    os.makedirs(out_dir, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES, "name": "intelliops-excursion-risk-v1"}, os.path.join(out_dir, "model.joblib"))
    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump({"auc": round(float(auc), 4), "positives": int(y.sum()), "rows": int(len(y))}, f, indent=2)
    print(f"saved model to {out_dir}  AUC={auc:.3f}")


if __name__ == "__main__":
    main()
