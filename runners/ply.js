const fs = require('fs');
const path = require('path');
const newman = require('newman');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const LIVE_PROGRESS_PATH = path.join(REPORTS_DIR, 'live-progress.json');
const NEWMAN_JSON_REPORT_PATH = path.join(REPORTS_DIR, 'newman-result.json');
const NEWMAN_HTML_REPORT_PATH = path.join(REPORTS_DIR, 'newman-report.html');

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let index = 0; index < args.length; index++) {
    const current = args[index];

    if (current.startsWith('--')) {
      const key = current.slice(2);
      const value = args[index + 1];

      if (value && !value.startsWith('--')) {
        params[key] = value;
        index++;
      } else {
        params[key] = true;
      }
    }
  }

  return {
    module: params.module || 'ply',
    runId: params.runId || null,
    collectionFile: params.collectionFile || process.env.POSTMAN_COLLECTION_FILE || 'collections/REGRESIVOS.postman_collection.json',
    environmentFile: params.environmentFile || process.env.POSTMAN_ENVIRONMENT_FILE || 'environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json',
    flow: params.flow || 'getmedia',
    folderName: params.folderName || params.folder || 'Getmedia',
    environment: params.environment || 'preuat',
    platform: params.platform || 'aws',
    serviceType: params.serviceType || 'ott',
    device: params.device || 'web',
    region: params.region || 'mexico',
    endpointType: params.endpointType || 'origin',
    userFlow: params.userFlow || null
  };
}

function resolveProjectPath(value) {
  if (path.isAbsolute(value)) return value;
  return path.join(ROOT_DIR, value);
}

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function validateFiles(params) {
  const collectionPath = resolveProjectPath(params.collectionFile);
  const environmentPath = resolveProjectPath(params.environmentFile);

  if (!fs.existsSync(collectionPath)) {
    throw new Error(`Collection file does not exist: ${collectionPath}`);
  }

  if (!fs.existsSync(environmentPath)) {
    throw new Error(`Environment file does not exist: ${environmentPath}`);
  }

  if (!params.folderName) {
    throw new Error('folderName is required. It maps the selected flow to a Newman folder.');
  }

  return { collectionPath, environmentPath };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function safeJsonParse(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function headersToObject(headers) {
  const result = {};
  if (!headers) return result;

  try {
    if (typeof headers.each === 'function') {
      headers.each(header => {
        result[header.key] = header.value;
      });
      return result;
    }

    if (Array.isArray(headers)) {
      headers.forEach(header => {
        result[header.key] = header.value;
      });
    }
  } catch (_) {
    return result;
  }

  return result;
}

function bodyFromRequest(request) {
  if (!request || !request.body) return null;

  try {
    if (request.body.raw) return safeJsonParse(request.body.raw);

    if (request.body.urlencoded) {
      const body = {};
      request.body.urlencoded.each(item => {
        body[item.key] = item.value;
      });
      return body;
    }

    if (request.body.formdata) {
      const body = {};
      request.body.formdata.each(item => {
        body[item.key] = item.value;
      });
      return body;
    }
  } catch (_) {
    return null;
  }

  return null;
}

function bodyFromResponse(response) {
  if (!response || !response.stream) return null;

  try {
    return safeJsonParse(response.stream.toString('utf8'));
  } catch (_) {
    return null;
  }
}

function clean(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function createInitialProgress(params) {
  return {
    execution: {
      status: 'RUNNING',
      module: params.module,
      runId: params.runId,
      collection: 'REGRESIVOS',
      buildNumber: process.env.BUILD_NUMBER || null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null
    },
    parameters: {
      module: params.module,
      flow: params.flow,
      folderName: params.folderName,
      collectionFile: params.collectionFile,
      environmentFile: params.environmentFile,
      environment: params.environment,
      platform: params.platform,
      serviceType: params.serviceType,
      device: params.device,
      region: params.region,
      endpointType: params.endpointType,
      userFlow: params.userFlow
    },
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      currentApi: null
    },
    apis: []
  };
}

function isVisibleServiceRequest(url) {
  return String(url || '').toLowerCase().includes('/services/');
}

function updateSummary(progress) {
  progress.summary.total = progress.apis.length;
  progress.summary.passed = progress.apis.filter(api => api.status === 'PASSED').length;
  progress.summary.failed = progress.apis.filter(api => api.status === 'FAILED').length;
  progress.summary.currentApi = progress.apis.length ? progress.apis[progress.apis.length - 1].name : null;
}

function buildEnvVars(params) {
  return [
    { key: 'environment', value: params.environment },
    { key: 'platform', value: params.platform },
    { key: 'serviceType', value: params.serviceType },
    { key: 'device', value: params.device },
    { key: 'region', value: params.region },
    { key: 'endpointType', value: params.endpointType }
  ];
}

function finish(progress, startedAtMs, status) {
  progress.execution.status = status;
  progress.execution.finishedAt = new Date().toISOString();
  progress.execution.durationMs = Date.now() - startedAtMs;
  updateSummary(progress);
  writeJson(LIVE_PROGRESS_PATH, progress);
}

async function run() {
  ensureReportsDir();

  const params = parseArgs();
  const { collectionPath, environmentPath } = validateFiles(params);
  const startedAtMs = Date.now();
  const progress = createInitialProgress(params);

  writeJson(LIVE_PROGRESS_PATH, progress);

  console.log('========================================');
  console.log(' QA POSTMAN RUNNER PLY');
  console.log('========================================');
  console.log('Run ID:', params.runId || '--');
  console.log('Collection:', collectionPath);
  console.log('Environment:', environmentPath);
  console.log('Flow:', params.flow);
  console.log('Folder:', params.folderName);
  console.log('Reports dir:', REPORTS_DIR);
  console.log('========================================');

  newman.run({
    collection: collectionPath,
    environment: environmentPath,
    folder: params.folderName,
    envVar: buildEnvVars(params),
    reporters: ['cli', 'json', 'htmlextra'],
    reporter: {
      json: { export: NEWMAN_JSON_REPORT_PATH },
      htmlextra: { export: NEWMAN_HTML_REPORT_PATH }
    }
  })
    .on('request', (error, args) => {
      const request = args.request;
      const response = args.response;
      const item = args.item;

      if (!request || !request.url) return;

      const url = request.url.toString();

      if (!isVisibleServiceRequest(url)) {
        return;
      }

      const statusCode = response ? response.code : null;
      const apiStatus = error || statusCode >= 400 ? 'FAILED' : 'PASSED';

      const api = {
        id: progress.apis.length + 1,
        itemId: item?.id || clean(item?.name),
        name: item?.name ? clean(item.name) : `${request.method} ${url}`,
        method: request.method,
        url,
        status: apiStatus,
        statusCode,
        statusText: response ? response.status : null,
        responseTime: response ? response.responseTime : null,
        executedAt: new Date().toISOString(),
        request: {
          headers: headersToObject(request.headers),
          body: bodyFromRequest(request)
        },
        response: {
          headers: response ? headersToObject(response.headers) : {},
          body: bodyFromResponse(response)
        },
        assertions: []
      };

      progress.apis.push(api);
      updateSummary(progress);
      writeJson(LIVE_PROGRESS_PATH, progress);

      console.log(`[LIVE] ${api.method} ${api.name} | ${api.statusCode || '--'} | ${api.responseTime || '--'}ms | ${api.status}`);
    })
    .on('assertion', (error, args) => {
      const lastApi = progress.apis[progress.apis.length - 1];
      if (!lastApi) return;

      const assertion = {
        name: clean(args.assertion),
        status: error ? 'FAILED' : 'PASSED',
        errorMessage: error ? error.message : null,
        executedAt: new Date().toISOString()
      };

      lastApi.assertions.push(assertion);
      if (error) lastApi.status = 'FAILED';

      updateSummary(progress);
      writeJson(LIVE_PROGRESS_PATH, progress);
    })
    .on('done', (error, summary) => {
      const failures = summary?.run?.failures?.length || 0;
      const status = error || failures > 0 ? 'FAILURE' : 'SUCCESS';

      finish(progress, startedAtMs, status);

      if (error) {
        console.error('[NEWMAN] Error:', error.message);
        process.exit(1);
      }

      if (failures > 0) {
        console.error(`[NEWMAN] Finished with failures: ${failures}`);
        process.exit(1);
      }

      console.log('[NEWMAN] Finished successfully');
      process.exit(0);
    });
}

run().catch(error => {
  console.error('[PLY] Error:', error.message);
  process.exit(1);
});
