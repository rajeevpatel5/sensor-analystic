const MAX_POINTS_PER_NODE = 360;

const readingsByNode = new Map();

function normalizeReading(reading) {
  return {
    nodeId: reading.nodeId || 'unknown',
    location: reading.location || 'Unknown',
    _time: reading.timestamp || new Date().toISOString(),
    temperature: Number(reading.temperature ?? 0),
    humidity: Number(reading.humidity ?? 0),
    air_quality: Number(reading.air_quality ?? 0),
    fire_alarm: Number(reading.fire_alarm ?? 0),
  };
}

function addReading(reading) {
  const normalized = normalizeReading(reading);
  const bucket = readingsByNode.get(normalized.nodeId) || [];
  bucket.push(normalized);

  if (bucket.length > MAX_POINTS_PER_NODE) {
    bucket.splice(0, bucket.length - MAX_POINTS_PER_NODE);
  }

  readingsByNode.set(normalized.nodeId, bucket);
  return normalized;
}

function getHistory(nodeId) {
  if (nodeId) {
    return [...(readingsByNode.get(nodeId) || [])];
  }

  return [...readingsByNode.values()]
    .flat()
    .sort((a, b) => new Date(a._time).getTime() - new Date(b._time).getTime());
}

function getLatest(nodeId) {
  const history = getHistory(nodeId);
  if (nodeId) {
    return history.slice(-1);
  }

  const latestPerNode = [];
  for (const nodeHistory of readingsByNode.values()) {
    const latest = nodeHistory[nodeHistory.length - 1];
    if (latest) latestPerNode.push(latest);
  }

  return latestPerNode;
}

module.exports = {
  addReading,
  getHistory,
  getLatest,
};
