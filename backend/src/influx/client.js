const { InfluxDB, Point } = require('@influxdata/influxdb-client');
require('dotenv').config();

const INFLUX_ENABLED = (process.env.INFLUX_ENABLED || 'true').toLowerCase() === 'true';

let client = null;
let writeApi = null;
let queryApi = null;

if (INFLUX_ENABLED) {
  client = new InfluxDB({
    url: process.env.INFLUX_URL,
    token: process.env.INFLUX_TOKEN,
  });

  writeApi = client.getWriteApi(process.env.INFLUX_ORG, process.env.INFLUX_BUCKET, 'ns');
  queryApi = client.getQueryApi(process.env.INFLUX_ORG);
} else {
  console.log('[InfluxDB] Disabled via INFLUX_ENABLED=false');
}

// write to database at point 'sensor_reading'
async function writeSensorData(nodeId, location, data) {
  try {
    if (!INFLUX_ENABLED) return false;
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const point = new Point('sensor_reading')
      .tag('node_id', nodeId)
      .tag('location', location)
      .floatField('temperature', data.temperature)
      .floatField('humidity', data.humidity)
      .floatField('air_quality', data.air_quality)
      .intField('fire_alarm', data.fire_alarm ? 1 : 0)
      .timestamp(timestamp);

    writeApi.writePoint(point);
    await writeApi.flush();
    return true;
  } catch (err) {
    console.error('[InfluxDB] Write error:', err.message);
    return false;
  }
}

async function queryHistory(nodeId, range = '1h') {
  if (!INFLUX_ENABLED) return [];
  const query = `
    from(bucket: "${process.env.INFLUX_BUCKET}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "sensor_reading")
      ${nodeId ? `|> filter(fn: (r) => r.node_id == "${nodeId}")` : ''}
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;

  return new Promise((resolve, reject) => {
    const rows = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        rows.push(tableMeta.toObject(row));
      },
      error(err) {
        console.error('[InfluxDB] Query error:', err);
        console.error('[InfluxDB] Message:', err?.message);
        console.error('[InfluxDB] Stack:', err?.stack);
        reject(err);
      },
      complete() {
        resolve(rows);
      },
    });
  });
}

async function queryHistoryDebug(range = '24h') {
  if (!INFLUX_ENABLED) return [];
  const query = `
    from(bucket: "${process.env.INFLUX_BUCKET}")
      |> range(start: -${range})
      |> limit(n: 10)
  `;

  console.log('Flux query:\n', query);

  return new Promise((resolve, reject) => {
    const rows = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        rows.push(tableMeta.toObject(row));
      },
      error(err) {
        console.error('[InfluxDB] Query error:', err);
        console.error('[InfluxDB] Message:', err?.message);
        console.error('[InfluxDB] Stack:', err?.stack);
        reject(err);
      },
      complete() {
        resolve(rows);
      },
    });
  });
}

async function queryLatest() {
  if (!INFLUX_ENABLED) return [];
  const query = `
    from(bucket: "${process.env.INFLUX_BUCKET}")
      |> range(start: -5m)
      |> filter(fn: (r) => r._measurement == "sensor_reading")
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;

  return new Promise((resolve) => {
    const rows = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) { rows.push(tableMeta.toObject(row)); },
      error() { resolve([]); },
      complete() { resolve(rows); },
    });
  });
}

module.exports = { writeSensorData, queryHistory, queryHistoryDebug, queryLatest };
