const path = require('path');
const { spawn } = require('child_process');

let analyticsProcess = null;

function startAnalyticsService() {
  if (analyticsProcess) return analyticsProcess;

  const analyticsDir = path.resolve(__dirname, '../../../analytics');
  analyticsProcess = spawn('python3', ['app.py'], {
    cwd: analyticsDir,
    stdio: 'pipe',
  });

  analyticsProcess.stdout.on('data', chunk => {
    process.stdout.write(`[Analytics] ${chunk}`);
  });

  analyticsProcess.stderr.on('data', chunk => {
    process.stderr.write(`[Analytics] ${chunk}`);
  });

  analyticsProcess.on('exit', code => {
    console.log(`[Analytics] Service exited with code ${code}`);
    analyticsProcess = null;
  });

  return analyticsProcess;
}

function stopAnalyticsService() {
  if (!analyticsProcess) return;
  analyticsProcess.kill();
  analyticsProcess = null;
}

module.exports = {
  startAnalyticsService,
  stopAnalyticsService,
};
