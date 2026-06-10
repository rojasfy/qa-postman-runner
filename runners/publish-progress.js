const fs = require('fs');
const http = require('http');
const https = require('https');

const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL || process.env.dashboardBaseUrl;
const moduleId = process.env.MODULE_ID || process.env.module;
const runId = process.env.RUN_ID || process.env.runId;
const progressFile = process.env.LIVE_PROGRESS_FILE || 'reports/live-progress.json';

function exitOk(message) {
  if (message) console.log(`[LIVE-PROGRESS] ${message}`);
  process.exit(0);
}

if (!dashboardBaseUrl || !moduleId || !runId) {
  exitOk('Skipped: DASHBOARD_BASE_URL, MODULE_ID or RUN_ID is empty.');
}

if (!fs.existsSync(progressFile)) {
  exitOk(`Skipped: ${progressFile} does not exist yet.`);
}

const target = `${dashboardBaseUrl.replace(/\/$/, '')}/api/${encodeURIComponent(moduleId)}/runs/${encodeURIComponent(runId)}/progress`;
const body = fs.readFileSync(progressFile);
const url = new URL(target);
const client = url.protocol === 'https:' ? https : http;

console.log(`[LIVE-PROGRESS] Publishing ${body.length} bytes to ${target}`);

const request = client.request(url, {
  method: 'POST',
  hostname: url.hostname,
  port: url.port,
  path: `${url.pathname}${url.search}`,
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': body.length
  }
}, response => {
  const chunks = [];

  response.on('data', chunk => chunks.push(chunk));
  response.on('end', () => {
    const responseBody = Buffer.concat(chunks).toString('utf8').slice(0, 500);
    const status = response.statusCode || 0;
    const level = status >= 200 && status < 300 ? 'OK' : 'WARN';

    console.log(`[LIVE-PROGRESS] ${level} HTTP ${status}${responseBody ? ` ${responseBody}` : ''}`);
    process.exit(0);
  });
});

request.on('error', error => {
  console.error(`[LIVE-PROGRESS] ERROR ${error.message}`);
  process.exit(0);
});

request.write(body);
request.end();

setTimeout(() => {
  console.error('[LIVE-PROGRESS] ERROR publish timeout after 5000ms');
  process.exit(0);
}, 5000);
