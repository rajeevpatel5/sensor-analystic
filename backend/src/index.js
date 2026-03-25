require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const WebSocket = require('ws');

const routes = require('./api/routes');
const { connectMQTT } = require('./mqtt/handler');
const { getHistory } = require('./store/liveStore');
const { startAnalyticsService, stopAnalyticsService } = require('./analytics/process');

async function checkInfluxHealth() {
  const enabled = (process.env.INFLUX_ENABLED || 'true').toLowerCase() === 'true';
  const influxUrl = process.env.INFLUX_URL;

  if (!enabled) {
    console.log('[InfluxDB] Health check skipped (INFLUX_ENABLED=false)');
    return;
  }

  if (!influxUrl) {
    console.error('[InfluxDB] UNREACHABLE: INFLUX_URL is not set');
    return;
  }

  try {
    const response = await fetch(influxUrl, { method: 'GET' });
    console.log(`[InfluxDB] Reachable: ${influxUrl} (status ${response.status})`);
  } catch (err) {
    console.error(`[InfluxDB] UNREACHABLE at ${influxUrl}`);
    console.error('[InfluxDB] Health check message:', err?.message);
  }
}

// start server and websocket
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.set('etag', false);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api', routes);

// websocket connection
wss.on('connection', ws => {
  console.log('[WS] Client connected. Total:', wss.clients.size);
  ws.send(JSON.stringify({ type: 'connected', message: 'IoT WebSocket ready' }));
  ws.send(JSON.stringify({ type: 'history_snapshot', data: getHistory() }));

  ws.on('close', () => {
    console.log('[WS] Client disconnected. Total:', wss.clients.size);
  });
});

// process of backend and API for analystic
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nIoT Backend running on http://localhost:${PORT}`);
  console.log(`WebSocket server on ws://localhost:${PORT}/ws`);
  console.log(`API docs: http://localhost:${PORT}/api/health\n`);
  console.log('INFLUX_URL:', process.env.INFLUX_URL);
  console.log('INFLUX_ORG:', process.env.INFLUX_ORG);
  console.log('INFLUX_BUCKET:', process.env.INFLUX_BUCKET);
  console.log('INFLUX_TOKEN exists:', !!process.env.INFLUX_TOKEN);
  checkInfluxHealth();

  startAnalyticsService();
  connectMQTT(wss);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopAnalyticsService();
  server.close(() => process.exit(0));
});
