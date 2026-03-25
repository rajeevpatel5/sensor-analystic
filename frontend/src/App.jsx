import { useEffect, useRef, useState } from 'react';
import GaugeCard from './components/GaugeCard';
import HistoryChart from './components/HistoryChart';
import PredictionPanel from './components/PredictionPanel';

const API_BASE = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000/ws';

// format the number to show
function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function getTone(field, value) {
  if (!Number.isFinite(value)) return 'neutral';
  if (field === 'temperature') return value > 35 ? 'danger' : value > 28 ? 'warn' : 'good';
  if (field === 'humidity') return value > 80 ? 'danger' : value > 65 ? 'warn' : 'good';
  if (field === 'air_quality') return value > 800 ? 'danger' : value > 650 ? 'warn' : 'good';
  return value ? 'danger' : 'good';
}

function getRangeMs(range) {
  const lookup = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  return lookup[range] || lookup['1h'];
}

function normalizeReading(item) {
  return {
    ...item,
    nodeId: item.nodeId || 'unknown',
    _time: item._time || item.timestamp || new Date().toISOString(),
    temperature: Number(item.temperature || 0),
    humidity: Number(item.humidity || 0),
    air_quality: Number(item.air_quality || 0),
    fire_alarm: Number(item.fire_alarm || 0),
  };
}

function buildRealtimePrediction(rows) {
  if (rows.length < 2) return null;

  const recent = rows.slice(-12);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const steps = Math.max(recent.length - 1, 1);
  const makeTrend = (delta, up, down, upLabel = 'rising', downLabel = 'falling') => {
    if (delta > up) return upLabel;
    if (delta < down) return downLabel;
    return 'stable';
  };
  const futureTimes = Array.from({ length: 3 }, (_, index) =>
    new Date(Date.now() + (index + 1) * 2 * 60 * 1000).toISOString()
  );
  const makeSeries = (lastValue, delta, digits = 1) =>
    futureTimes.map((timestamp, index) => ({
      timestamp,
      value: Number((lastValue + (delta / steps) * (index + 1)).toFixed(digits)),
    }));

  return {
    trends: {
      temperature: makeTrend(last.temperature - first.temperature, 0.8, -0.8),
      humidity: makeTrend(last.humidity - first.humidity, 4, -4),
      air_quality: makeTrend(last.air_quality - first.air_quality, 80, -80, 'increasing', 'decreasing'),
    },
    temperature: makeSeries(last.temperature, last.temperature - first.temperature, 1),
    humidity: makeSeries(last.humidity, last.humidity - first.humidity, 1),
    air_quality: makeSeries(last.air_quality, last.air_quality - first.air_quality, 0),
  };
}

function buildSyntheticHistoryFromForecast(forecast, nodeId = 'node-01') {
  if (!forecast?.temperature?.length || !forecast?.humidity?.length || !forecast?.air_quality?.length) {
    return [];
  }

  const len = Math.min(
    forecast.temperature.length,
    forecast.humidity.length,
    forecast.air_quality.length
  );

  return Array.from({ length: len }, (_, index) => ({
    nodeId,
    _time: forecast.temperature[index].timestamp || new Date().toISOString(),
    temperature: Number(forecast.temperature[index].value || 0),
    humidity: Number(forecast.humidity[index].value || 0),
    air_quality: Number(forecast.air_quality[index].value || 0),
    fire_alarm: 0,
    source: 'forecast_fallback',
  }));
}

export default function App() {
  // state of app
  const [nodes, setNodes] = useState([]);
  const [range, setRange] = useState('1h');
  const [allHistory, setAllHistory] = useState([]);
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [connection, setConnection] = useState('CONNECTING');
  const [forecasts, setForecasts] = useState({});
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState('');
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const forecastTimerRef = useRef(null);

  // node
  useEffect(() => {
    async function loadNodes() {
      const response = await fetch(`${API_BASE}/nodes`);
      const payload = await response.json();
      if (payload.success && payload.nodes?.length) {
        setNodes(payload.nodes);
      }
    }

    loadNodes().catch(() => {
      setNodes([{ id: 'node-01', location: 'External MQTT Node' }]);
    });
  }, []);

  // history of node
  useEffect(() => {
    const now = Date.now();
    const filtered = allHistory
      .filter(item => item.nodeId === 'node-01')
      .filter(item => now - new Date(item._time).getTime() <= getRangeMs(range))
      .sort((a, b) => new Date(a._time).getTime() - new Date(b._time).getTime());

    setHistory(filtered);
    setLatest(filtered[filtered.length - 1] || null);
  }, [allHistory, range]);

  // API fallback when websocket has not streamed any data yet.
  useEffect(() => {
    let cancelled = false;

    async function loadHistoryFallback() {
      try {
        const response = await fetch(`${API_BASE}/sensors/history?nodeId=node-01&range=24h`);
        const payload = await response.json();
        if (!payload?.success || !Array.isArray(payload.data)) return;

        const normalized = payload.data.map(normalizeReading);
        if (!cancelled && normalized.length) {
          setAllHistory(current => (current.length ? current : normalized.slice(-720)));
        }
      } catch {
        // keep websocket-first behavior; ignore fallback fetch errors
      }
    }

    loadHistoryFallback();
    const timer = setInterval(() => {
      loadHistoryFallback();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // prediction
  useEffect(() => {
    let cancelled = false;
    const horizons = ['1h', '6h', '12h', '24h'];

    async function loadForecasts() {
      setPredictionLoading(true);
      setPredictionError('');

      try {
        const results = await Promise.all(
          horizons.map(async horizon => {
            const response = await fetch(`${API_BASE}/predict?nodeId=node-01&range=24h&horizon=${horizon}`);
            const payload = await response.json();
            return [horizon, payload.data || buildRealtimePrediction(history) || null];
          })
        );

        if (!cancelled) {
          const mapped = Object.fromEntries(results);
          setForecasts(mapped);

          if (!allHistory.length) {
            const synthetic = buildSyntheticHistoryFromForecast(mapped['1h']);
            if (synthetic.length) {
              setAllHistory(current => (current.length ? current : synthetic));
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPredictionError('Cannot load forecast from analytics service');
          setForecasts({});
        }
      } finally {
        if (!cancelled) {
          setPredictionLoading(false);
        }
      }
    }

    const scheduleLoad = delayMs => {
      if (forecastTimerRef.current) clearTimeout(forecastTimerRef.current);
      forecastTimerRef.current = setTimeout(() => {
        loadForecasts();
      }, delayMs);
    };

    scheduleLoad(500);
    const timer = setInterval(() => {
      loadForecasts();
    }, 15000);

    return () => {
      cancelled = true;
      if (forecastTimerRef.current) clearTimeout(forecastTimerRef.current);
      clearInterval(timer);
    };
  }, [latest?._time, allHistory.length]);

  // connect to websocket
  useEffect(() => {
    let shouldReconnect = true;

    function connectWebSocket() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnection('LIVE');
      };

      ws.onerror = () => {
        setConnection('ERROR');
      };

      ws.onclose = () => {
        setConnection('DISCONNECTED');
        if (shouldReconnect) {
          reconnectTimerRef.current = setTimeout(connectWebSocket, 1500);
        }
      };

      ws.onmessage = event => {
        const payload = JSON.parse(event.data);

        if (payload.type === 'history_snapshot') {
          const snapshot = (payload.data || []).map(normalizeReading);
          setAllHistory(snapshot.slice(-720));
          return;
        }

        if (payload.type !== 'sensor_update') return;

        const normalized = normalizeReading({
          ...payload,
          timestamp: payload.timestamp,
        });

        setAllHistory(current => [...current, normalized].slice(-720));
      };
    }

    connectWebSocket();

    return () => {
      shouldReconnect = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="hero">
        <h1>Sensor Analytics</h1>
        <p>Real-time Environmental Monitoring</p>
        <div className={`status-pill status-${connection.toLowerCase()}`}>{connection === 'LIVE' ? 'WS CONNECTED' : connection}</div>
        <div className="last-update">
          {latest ? `Last update: ${latest.changedField || 'sensor'} at ${new Date(latest._time).toLocaleTimeString()}` : 'Waiting for first sensor packet'}
        </div>
      </header>

      {/* Gauges */}
      <section className="gauge-grid">
        <GaugeCard
          label="Temperature"
          value={formatNumber(latest?.temperature)}
          unit="degC"
          tone={getTone('temperature', latest?.temperature)}
          helper="Live sensor reading"
        />
        <GaugeCard
          label="Humidity"
          value={formatNumber(latest?.humidity)}
          unit="%"
          tone={getTone('humidity', latest?.humidity)}
          helper="Relative humidity"
        />
        <GaugeCard
          label="Air Quality"
          value={Number.isFinite(latest?.air_quality) ? Math.round(latest.air_quality) : '--'}
          unit="ppm"
          tone={getTone('air_quality', latest?.air_quality)}
          helper="Estimated indoor air quality"
        />
        <GaugeCard
          label="Fire Alarm"
          value={latest?.fire_alarm ? 'ALERT' : 'OK'}
          unit=""
          tone={getTone('fire_alarm', latest?.fire_alarm)}
          helper={latest?.fire_alarm ? 'Emergency state' : 'Normal'}
        />
      </section>

      {/* Charts */}
      <section className="content-grid">
        <div className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h3>History</h3>
            </div>
            <div className="helper-text">{history.length} points streamed</div>
          </div>
          <HistoryChart data={history} />
        </div>

        <PredictionPanel
          forecasts={forecasts}
          loading={predictionLoading}
          error={predictionError}
        />
      </section>
    </div>
  );
}
