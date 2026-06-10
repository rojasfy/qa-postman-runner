const fs = require('fs');
const http = require('http');
const https = require('https');

const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL || process.env.dashboardBaseUrl;
const moduleId = process.env.MODULE_ID || process.env.module;
const runId = process.env.RUN_ID || process.env.runId;
const progressFile = process.env.LIVE_PROGRESS_FILE || 'reports/live-progress.json';
const payloadMode = String(process.env.LIVE_PROGRESS_MODE || 'filtered').toLowerCase();
const timeoutMs = Number(process.env.LIVE_PROGRESS_TIMEOUT_MS || 3000);
const MAX_URL_LENGTH = 220;
const REQUEST_BODY_LIMIT_BYTES = Number(process.env.LIVE_PROGRESS_BODY_LIMIT_BYTES || 5120);
const HEADER_WHITELIST = new Set(['partition', 'true-client-ip', 'authorization', 'token', 'user-token']);
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

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
const source = fs.readFileSync(progressFile, 'utf8');
const payload = buildPayload(source);
const body = Buffer.from(JSON.stringify(payload), 'utf8');
const url = new URL(target);
const client = url.protocol === 'https:' ? https : http;

logPayloadMetrics(source, payload, body.length);
console.log(`[LIVE-PROGRESS] Publishing ${payloadMode} payload ${body.length} bytes to ${target}`);

function buildPayload(raw) {
  if (payloadMode === 'full') {
    return JSON.parse(raw);
  }

  return toReducedProgress(JSON.parse(raw));
}

function normalizeStatus(value) {
  const status = String(value || 'UNKNOWN').toUpperCase();
  if (status === 'PASSED') return 'SUCCESS';
  if (status === 'FAILED') return 'FAILURE';
  return status;
}

function toServicePath(value) {
  const rawUrl = String(value || '');
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.slice(0, MAX_URL_LENGTH);
  } catch (_) {
    const withoutQuery = rawUrl.split('?')[0];
    return withoutQuery.slice(0, MAX_URL_LENGTH);
  }
}

function normalizeHeaders(headers = {}) {
  const result = {};

  Object.entries(headers || {}).forEach(([key, value]) => {
    const normalizedKey = String(key || '').toLowerCase();
    if (!HEADER_WHITELIST.has(normalizedKey)) return;

    result[normalizedKey] = shouldMaskHeader(normalizedKey, value)
      ? maskSensitiveValue(value)
      : value;
  });

  return result;
}

function shouldMaskHeader(key, value) {
  const normalizedKey = String(key || '').toLowerCase();
  const text = String(value || '');

  return normalizedKey.includes('authorization')
    || normalizedKey.includes('token')
    || /^Bearer\s+\S+/i.test(text)
    || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text);
}

function maskSensitiveValue(value) {
  const text = String(value || '');
  const bearerMatch = text.match(/^(Bearer\s+)(.+)$/i);

  if (bearerMatch) {
    return `${bearerMatch[1]}${bearerMatch[2].slice(0, 10)}...<masked>`;
  }

  if (text.length <= 10) return '<masked>';

  return `${text.slice(0, 10)}...<masked>`;
}

function measureJsonBytes(value) {
  if (value === undefined || value === null) return 0;
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function truncateBody(value, originalBodySize) {
  if (payloadMode !== 'truncated' || originalBodySize <= REQUEST_BODY_LIMIT_BYTES) {
    return {
      body: value,
      bodyTruncated: false,
      originalBodySize
    };
  }

  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const truncated = Buffer.from(serialized, 'utf8')
    .subarray(0, REQUEST_BODY_LIMIT_BYTES)
    .toString('utf8');

  return {
    body: truncated,
    bodyTruncated: true,
    originalBodySize
  };
}

function buildRequestDebug(api) {
  const method = String(api.method || '').toUpperCase();
  const request = {
    headers: normalizeHeaders(api.request?.headers || {})
  };

  if (!METHODS_WITH_BODY.has(method) || api.request?.body === undefined || api.request?.body === null) {
    return request;
  }

  const originalBodySize = measureJsonBytes(api.request.body);
  return {
    ...request,
    ...truncateBody(api.request.body, originalBodySize)
  };
}

function buildResponseDebug(api) {
  return {
    statusCode: api.statusCode || api.response?.statusCode || null,
    statusText: api.statusText || api.response?.statusText || null,
    timeMs: api.responseTime || api.response?.timeMs || null,
    headers: normalizeHeaders(api.response?.headers || {})
  };
}

function countAssertions(api, status) {
  const assertions = Array.isArray(api.assertions) ? api.assertions : [];

  return {
    total: assertions.length,
    passed: assertions.filter(assertion => normalizeStatus(assertion.status) === 'SUCCESS').length,
    failed: assertions.filter(assertion => normalizeStatus(assertion.status) === 'FAILURE').length,
    status: normalizeStatus(status)
  };
}

function toSlimApi(api) {
  const status = normalizeStatus(api.status);
  const path = toServicePath(api.url || api.path);

  return {
    id: String(api.id || api.itemId || `${api.name || 'api'}-${api.executedAt || ''}`),
    itemId: api.itemId || null,
    name: api.name || path || 'Unnamed API',
    method: api.method || null,
    path,
    status,
    statusCode: api.statusCode || api.response?.statusCode || null,
    statusText: api.statusText || api.response?.statusText || null,
    responseTime: api.responseTime || api.response?.timeMs || null,
    executedAt: api.executedAt || null,
    request: buildRequestDebug(api),
    response: buildResponseDebug(api),
    assertions: [countAssertions(api, status)]
  };
}

function toReducedProgress(progress) {
  const rawApis = Array.isArray(progress.apis)
    ? progress.apis
    : (Array.isArray(progress.apiExecutions) ? progress.apiExecutions : []);
  const apis = rawApis.map(toSlimApi);
  const passed = apis.filter(api => api.status === 'SUCCESS').length;
  const failed = apis.filter(api => api.status === 'FAILURE').length;
  const lastExecution = apis.length ? apis[apis.length - 1] : null;
  const summary = {
    total: apis.length,
    passed,
    failed,
    currentApi: lastExecution?.name || progress.summary?.currentApi || null
  };

  return {
    execution: progress.execution || {},
    parameters: progress.parameters || {},
    summary,
    counters: {
      total: summary.total,
      passed,
      failed
    },
    currentApi: summary.currentApi,
    lastExecution,
    apis
  };
}

function logPayloadMetrics(raw, payload, payloadBytes) {
  let progress;

  try {
    progress = JSON.parse(raw);
  } catch (_) {
    progress = {};
  }

  const rawApis = Array.isArray(progress.apis)
    ? progress.apis
    : (Array.isArray(progress.apiExecutions) ? progress.apiExecutions : []);
  const apiBytes = rawApis.map(api => measureJsonBytes(api));
  const totalApiBytes = apiBytes.reduce((sum, size) => sum + size, 0);
  const avgApiBytes = rawApis.length ? Math.round(totalApiBytes / rawApis.length) : 0;
  const scenario = payloadMode === 'full'
    ? 'A full'
    : (payloadMode === 'truncated' ? 'C filtered+truncated' : 'B filtered');

  console.log(
    `[LIVE-PROGRESS] Metrics scenario=${scenario} fileBytes=${Buffer.byteLength(raw, 'utf8')} apiExecutions=${rawApis.length} avgApiExecutionBytes=${avgApiBytes} payloadBytes=${payloadBytes}`
  );
}

let timeout;

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
    clearTimeout(timeout);
    const responseBody = Buffer.concat(chunks).toString('utf8').slice(0, 500);
    const status = response.statusCode || 0;
    const level = status >= 200 && status < 300 ? 'OK' : 'WARN';

    console.log(`[LIVE-PROGRESS] ${level} HTTP ${status}${responseBody ? ` ${responseBody}` : ''}`);
    process.exit(0);
  });
});

request.on('error', error => {
  clearTimeout(timeout);
  console.error(`[LIVE-PROGRESS] ERROR ${error.message}`);
  process.exit(0);
});

request.write(body);
request.end();

timeout = setTimeout(() => {
  console.error(`[LIVE-PROGRESS] ERROR publish timeout after ${timeoutMs}ms`);
  request.destroy(new Error(`publish timeout after ${timeoutMs}ms`));
}, timeoutMs);
