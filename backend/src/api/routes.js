const express = require('express');
const router = express.Router();
const { queryHistory, queryHistoryDebug, queryLatest } = require('../influx/client');
const { NODES } = require('../mqtt/handler');
const { getHistory, getLatest } = require('../store/liveStore');
const axios = require('axios').default;
require('dotenv').config();

const INFLUX_ENABLED = (process.env.INFLUX_ENABLED || 'true').toLowerCase() === 'true';

// GET /api/nodes - list all sensor nodes
router.get('/nodes', (req, res) => {
  res.json({ success: true, nodes: NODES });
});

// GET /api/sensors/latest - latest reading from all nodes
router.get('/sensors/latest', async (req, res) => {
  try {
    const data = INFLUX_ENABLED ? await queryLatest() : getLatest(req.query.nodeId);
    res.json({ success: true, data });
  } catch (err) {
    if (err?.code === 'ECONNREFUSED') {
      return res.status(200).json({
        success: true,
        data: getLatest(req.query.nodeId),
        fallback: true,
        message: 'InfluxDB is unreachable. Returned local latest data.',
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sensors/history?nodeId=node_A1&range=1h
router.get('/sensors/history', async (req, res) => {
  try {
    const { nodeId, range = '1h' } = req.query;
    const validRanges = ['15m', '1h', '6h', '24h', '7d'];
    const safeRange = validRanges.includes(range) ? range : '1h';
    const data = INFLUX_ENABLED ? await queryHistory(nodeId, safeRange) : getHistory(nodeId);
    res.json({ success: true, data, range: safeRange, nodeId });
  } catch (err) {
    if (err?.code === 'ECONNREFUSED') {
      return res.status(200).json({
        success: true,
        data: getHistory(req.query.nodeId),
        range: req.query.range || '1h',
        nodeId: req.query.nodeId,
        fallback: true,
        message: 'InfluxDB is unreachable. Returned local history data.',
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/predict?nodeId=node_A1 - get ML prediction from analytics service
router.get('/predict', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { nodeId = 'node_A1', horizon = '1h' } = req.query;
    const history = INFLUX_ENABLED ? await queryHistoryDebug('24h') : getHistory(nodeId);

    if (history.length < 5) {
      return res.json({ success: false, message: 'Not enough data for prediction', data: null });
    }

    const response = await axios.post(`${process.env.ANALYTICS_URL}/predict`, {
      nodeId,
      horizon,
      history: history.map(r => ({
        timestamp: r._time,
        temperature: r.temperature,
        humidity: r.humidity,
        air_quality: r.air_quality,
      }))
    }, { timeout: 8000 });

    res.json({ success: true, data: response.data, horizon });
  } catch (err) {
    console.error('[InfluxDB] Query error:', err);
    console.error('[InfluxDB] Message:', err?.message);
    console.error('[InfluxDB] Stack:', err?.stack);

    if (err?.code === 'ECONNREFUSED') {
      return res.status(200).json({
        success: true,
        data: generateFallbackPrediction(),
        fallback: true,
        message: 'InfluxDB is unreachable. Returned fallback prediction.',
      });
    }

    return res.status(500).json({
      error: 'InfluxDB query failed',
      message: err?.message || String(err),
    });
  }
});

function generateFallbackPrediction() {
  const now = Date.now();
  return {
    temperature: Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(now + i * 600000).toISOString(),
      value: +(17 + Math.sin(i * 0.5) * 2 + Math.random()).toFixed(1)
    })),
    humidity: Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(now + i * 600000).toISOString(),
      value: +(58 + Math.random() * 5).toFixed(1)
    })),
    air_quality: Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(now + i * 600000).toISOString(),
      value: +(820 + Math.random() * 120).toFixed(0)
    })),
    trends: {
      temperature: 'stable',
      humidity: 'stable',
      air_quality: 'stable',
    },
  };
}

// GET /api/health
router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
