function formatTrend(value) {
  if (!value) return 'No data';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getLastValue(series, digits = 1) {
  if (!series?.length) return '--';
  return Number(series[series.length - 1].value).toFixed(digits);
}

export default function PredictionPanel({ forecasts, loading, error }) {
  const horizons = ['1h', '6h', '12h', '24h'];
  const reference = forecasts?.['1h'];

  return (
    <div className="panel prediction-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Trend Forecast</div>
          <h3>Next 1h, 6h, 12h, 24h</h3>
        </div>
        <div className="badge badge-ok">scikit-learn</div>
      </div>

      {loading ? <div className="empty-state">Loading prediction...</div> : null}
      {error ? <div className="empty-state error-text">{error}</div> : null}

      {!loading && !error && reference ? (
        <>
          <div className="trend-grid">
            <div className="trend-chip">Temp: {formatTrend(reference.trends?.temperature)}</div>
            <div className="trend-chip">Humidity: {formatTrend(reference.trends?.humidity)}</div>
            <div className="trend-chip">Air: {formatTrend(reference.trends?.air_quality)}</div>
          </div>

          <div className="forecast-summary">
            {horizons.map(horizon => {
              const item = forecasts?.[horizon];
              return (
                <div key={horizon} className="forecast-card">
                  <div className="forecast-horizon">{horizon} ahead</div>
                  <div className="forecast-metric">Temp: <b>{getLastValue(item?.temperature, 1)} degC</b></div>
                  <div className="forecast-metric">Humidity: <b>{getLastValue(item?.humidity, 1)} %</b></div>
                  <div className="forecast-metric">Air: <b>{getLastValue(item?.air_quality, 0)} ppm</b></div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
