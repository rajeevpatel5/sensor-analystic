const mqtt = require('mqtt');
const { writeSensorData } = require('../influx/client');
const { addReading } = require('../store/liveStore');
require('dotenv').config();

let mqttClient = null;
let wss = null;

const NODES = [
  { id: process.env.MQTT_NODE_ID || 'node-01', location: process.env.MQTT_NODE_LOCATION || 'EMQX' },
];

// config for MQTT
const MQTT_TOPIC_SENSOR = process.env.MQTT_TOPIC_SENSOR || 'node-01-for-test';
const DEFAULT_NODE_ID = process.env.MQTT_NODE_ID || 'node-01';
const DEFAULT_LOCATION = process.env.MQTT_NODE_LOCATION || 'EMQX';


function broadcastToClients(data) {
  if (!wss) return;

  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// use thresholds for waring
function checkThresholds(data) {
  const alerts = [];

  if (data.temperature > 35) {
    alerts.push({ field: 'temperature', value: data.temperature, message: `High temp: ${data.temperature}C` });
  }
  if (data.humidity > 80) {
    alerts.push({ field: 'humidity', value: data.humidity, message: `High humidity: ${data.humidity}%` });
  }
  if (data.air_quality > 800) {
    alerts.push({ field: 'air_quality', value: data.air_quality, message: `Bad air quality: ${data.air_quality} ppm` });
  }
  if (data.fire_alarm) {
    alerts.push({ field: 'fire_alarm', value: 1, message: `Fire at: ${data.location}!` });
  }

  return alerts;
}

// receive payload from mqtt
async function emitSensorPayload(payload) {
  addReading(payload);
  console.log(`[MQTT] Received payload for ${payload.nodeId}`);

  await writeSensorData(payload.nodeId, payload.location, payload);
  broadcastToClients({ type: 'sensor_update', ...payload });

  const alerts = checkThresholds(payload);
  if (alerts.length > 0) {
    broadcastToClients({
      type: 'alert',
      nodeId: payload.nodeId,
      location: payload.location,
      alerts,
      timestamp: payload.timestamp,
    });
  }
}

function normalizeIncomingPayload(topic, message) {
  const parsed = JSON.parse(message.toString());
  const topicParts = topic.split('/');
  const topicNodeId = topicParts.length > 1 ? topicParts[topicParts.length - 1] : null;

  return {
    nodeId: parsed.nodeId || topicNodeId || DEFAULT_NODE_ID,
    location: parsed.location || DEFAULT_LOCATION,
    temperature: Number(parsed.temperature || 0),
    humidity: Number(parsed.humidity || 0),
    air_quality: Number(parsed.air_quality || 0),
    fire_alarm: Number(parsed.fire_alarm || 0),
    timestamp: parsed.timestamp || new Date().toISOString(),
    source: 'mqtt',
  };
}

// connect to broker
function connectMQTT(wsServer) {
  wss = wsServer;

  try {
    const protocol = process.env.MQTT_PROTOCOL || 'mqtt';
    const host = process.env.MQTT_HOST;
    const port = process.env.MQTT_PORT;
    const options = {
      connectTimeout: 5000,
      reconnectPeriod: 10000,
    };

    if (process.env.MQTT_USER) options.username = process.env.MQTT_USER;
    if (process.env.MQTT_PASS) options.password = process.env.MQTT_PASS;

    mqttClient = mqtt.connect(`${protocol}://${host}:${port}`, options);

    mqttClient.on('connect', () => {
      console.log('[MQTT] Connected to broker');
      mqttClient.subscribe(MQTT_TOPIC_SENSOR, err => {
        if (!err) {
          console.log('[MQTT] Subscribed to topic:', MQTT_TOPIC_SENSOR);
        }
      });
    });

    mqttClient.on('message', async (topic, message) => {
      try {
        const payload = normalizeIncomingPayload(topic, message);
        await emitSensorPayload(payload);
      } catch (error) {
        console.error('[MQTT] Parse error:', error.message, '| topic:', topic, '| raw:', message.toString());
      }
    });

    mqttClient.on('error', err => {
      console.log('[MQTT] Broker error:', err.message);
    });
  } catch (error) {
    console.log('[MQTT] Could not connect:', error.message);
  }
}

module.exports = { connectMQTT, NODES };
