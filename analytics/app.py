from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

app = Flask(__name__)
CORS(app)

# Prediction settings.
# Example: 1h = 6 forecast points, each point 10 minutes apart.
HORIZON_CONFIG = {
    "1h": {"n_future": 6, "interval_ms": 10 * 60 * 1000},
    "6h": {"n_future": 6, "interval_ms": 60 * 60 * 1000},
    "12h": {"n_future": 6, "interval_ms": 2 * 60 * 60 * 1000},
    "24h": {"n_future": 6, "interval_ms": 4 * 60 * 60 * 1000},
}


def predict_trend(values, n_future=6):
    # no data, return zeros to keep response shape stable.
    if len(values) == 0:
        return [0] * n_future

    # too short, repeat the latest value.
    if len(values) < 3:
        return [values[-1]] * n_future

    # build a simple time for linear regression.
    x_values = np.arange(len(values)).reshape(-1, 1)
    y_values = np.array(values)

    model = LinearRegression()
    model.fit(x_values, y_values)

    # predict the next future
    future_x = np.arange(len(values), len(values) + n_future).reshape(-1, 1)
    return model.predict(future_x).tolist()


def detect_trend(values):
    # Classify the overall direction 
    if len(values) < 2:
        return "stable"

    diff = values[-1] - values[0]
    if diff > 1.5:
        return "rising"
    if diff < -1.5:
        return "falling"
    return "stable"


@app.route("/predict", methods=["POST"])
def predict():
    try:
        # receive sensor history 
        body = request.get_json()
        history = body.get("history", [])
        node_id = body.get("nodeId", "unknown")
        horizon = body.get("horizon", "1h")
        config = HORIZON_CONFIG.get(horizon, HORIZON_CONFIG["1h"])

        if len(history) < 3:
            return jsonify({"error": "Need at least 3 points data"}), 400

        # convert data
        df = pd.DataFrame(history)
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values("timestamp")

        #split data
        temps = df["temperature"].dropna().tolist()
        humids = df["humidity"].dropna().tolist()
        aqs = df["air_quality"].dropna().tolist()

        # Ensure every metric has a usable seed value.
        if len(temps) == 0:
            temps = [0.0]
        if len(humids) == 0:
            humids = [0.0]
        if len(aqs) == 0:
            aqs = [0.0]

        # create future timestamps 
        last_ts = df["timestamp"].iloc[-1].timestamp() * 1000
        future_ts = [
            pd.Timestamp(last_ts + (index + 1) * config["interval_ms"], unit="ms").isoformat()
            for index in range(config["n_future"])
        ]

        # run prediction
        temp_predictions = predict_trend(temps, config["n_future"])
        humid_predictions = predict_trend(humids, config["n_future"])
        aq_predictions = predict_trend(aqs, config["n_future"])

        # return forecast data and trend labels 
        return jsonify(
            {
                "nodeId": node_id,
                "horizon": horizon,
                "temperature": [
                    {"timestamp": future_ts[index], "value": round(value, 1)}
                    for index, value in enumerate(temp_predictions)
                ],
                "humidity": [
                    {"timestamp": future_ts[index], "value": round(value, 1)}
                    for index, value in enumerate(humid_predictions)
                ],
                "air_quality": [
                    {"timestamp": future_ts[index], "value": round(value, 0)}
                    for index, value in enumerate(aq_predictions)
                ],
                "trends": {
                    "temperature": detect_trend(temps),
                    "humidity": detect_trend(humids),
                    "air_quality": detect_trend(aqs),
                },
            }
        )
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print("Analytics microservice running on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
