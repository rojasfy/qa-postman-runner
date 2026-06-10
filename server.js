require('dotenv').config();

const express = require('express');
const path = require('path');
const os = require('os');
const axios = require('axios');
const cors = require('cors');

const { RunStore, FINAL_STATUSES, createDefaultSummary } = require('./src/runStore');
const {
  getModuleConfig,
  listModules,
  listFlows,
  resolveFlow,
  getCollectionLabel
} = require('./src/modules');
const { mapProgressToRun, normalizeStatus } = require('./src/progressMapper');

const app = express();
const runStore = new RunStore({ limitPerModule: Number(process.env.RUN_STORE_LIMIT_PER_MODULE || 50) });

const PORT = process.env.PORT || 3000;
const JENKINS_BASE_URL = process.env.JENKINS_BASE_URL;
const JENKINS_USER = process.env.JENKINS_USER;
const JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN;
const JENKINS_POLL_INTERVAL_MS = Number(process.env.JENKINS_POLL_INTERVAL_MS || 1500);
const JENKINS_DASHBOARD_BASE_URL = process.env.JENKINS_DASHBOARD_BASE_URL || getDashboardBaseUrlForJenkins(PORT);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '75mb';

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  if (!error) return next();

  if (error.type === 'entity.too.large' || error instanceof SyntaxError) {
    console.warn(`[LIVE-PROGRESS] Rejected payload ${req.method} ${req.originalUrl}: ${error.message}`);
    return res.status(error.status || 400).json({
      ok: false,
      message: error.type === 'entity.too.large' ? 'Live progress payload is too large.' : 'Invalid JSON payload.'
    });
  }

  return next(error);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live-viewer.html'));
});

app.get('/api/modules', (req, res) => {
  res.json({ ok: true, data: listModules() });
});

app.get('/api/:module/flows', (req, res) => {
  const moduleConfig = getModuleOr404(req.params.module, res);
  if (!moduleConfig) return;

  res.json({
    ok: true,
    module: moduleConfig.id,
    enabled: moduleConfig.enabled,
    data: listFlows(moduleConfig.id)
  });
});

app.get('/api/:module/runs', (req, res) => {
  const moduleConfig = getModuleOr404(req.params.module, res);
  if (!moduleConfig) return;

  res.json({
    ok: true,
    module: moduleConfig.id,
    enabled: moduleConfig.enabled,
    data: runStore.list(moduleConfig.id)
  });
});

app.post('/api/:module/runs', async (req, res) => {
  try {
    const moduleConfig = getModuleOr404(req.params.module, res);
    if (!moduleConfig) return;

    ensureModuleOperational(moduleConfig);

    const run = await createRun(moduleConfig, req.body || {});

    res.status(202).json({
      ok: true,
      message: `${moduleConfig.label} run queued in Jenkins.`,
      data: run
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
      data: error.run || null
    });
  }
});

app.get('/api/:module/runs/:runId', (req, res) => {
  const run = getRunOr404(req.params.module, req.params.runId, res);
  if (!run) return;

  res.json({ ok: true, data: run });
});

app.get('/api/:module/runs/:runId/status', async (req, res) => {
  const run = getRunOr404(req.params.module, req.params.runId, res);
  if (!run) return;

  await refreshRunFromJenkins(run);

  res.json({ ok: true, data: runStore.get(run.module, run.id) });
});

app.get('/api/:module/runs/:runId/progress', async (req, res) => {
  let run = getRunOr404(req.params.module, req.params.runId, res);
  if (!run) return;

  if (run.buildNumber && FINAL_STATUSES.has(String(run.status || '').toUpperCase()) && !run.apiExecutions?.length) {
    const artifactPatch = await getLiveProgressPatchFromJenkinsArtifact(run);

    if (artifactPatch) {
      run = runStore.update(run.module, run.id, {
        ...artifactPatch,
        reports: {
          ...run.reports,
          ...artifactPatch.reports,
          links: buildReportLinks({ ...run, ...artifactPatch })
        }
      }) || run;
    }
  }

  res.json({
    ok: true,
    data: {
      id: run.id,
      module: run.module,
      flow: run.flow,
      newmanFolder: run.newmanFolder,
      status: run.status,
      summary: run.summary,
      apiExecutions: run.apiExecutions,
      executionSteps: run.executionSteps,
      qaConsole: run.qaConsole,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt
    }
  });
});

app.post('/api/:module/runs/:runId/progress', (req, res) => {
  const run = getRunOr404(req.params.module, req.params.runId, res);
  if (!run) return;

  const progress = req.body;

  if (!progress || typeof progress !== 'object' || !progress.execution) {
    console.warn(`[LIVE-PROGRESS] Invalid payload for ${req.params.module}/${req.params.runId}`);
    return res.status(400).json({
      ok: false,
      message: 'Invalid live progress payload.'
    });
  }

  const patch = mapProgressToRun(progress, run);
  const buildNumber = progress.execution?.buildNumber || run.buildNumber;

  const updatedRun = runStore.update(run.module, run.id, {
    ...patch,
    buildNumber,
    buildUrl: buildNumber ? `${getJobUrl(run.jobName)}/${buildNumber}/` : run.buildUrl,
    reports: {
      ...run.reports,
      ...patch.reports,
      links: buildReportLinks({ ...run, ...patch, buildNumber })
    }
  });

  console.log(
    `[LIVE-PROGRESS] ${run.module}/${run.id} status=${updatedRun.status} build=${updatedRun.buildNumber || '--'} apis=${updatedRun.apiExecutions?.length || 0}`
  );

  res.json({
    ok: true,
    data: {
      id: updatedRun.id,
      module: updatedRun.module,
      status: updatedRun.status,
      buildNumber: updatedRun.buildNumber || null,
      summary: updatedRun.summary,
      apiExecutionsCount: updatedRun.apiExecutions?.length || 0,
      syncedAt: updatedRun.reports?.syncedAt || updatedRun.updatedAt || new Date().toISOString()
    }
  });
});

app.get('/api/:module/runs/:runId/reports', async (req, res) => {
  const run = getRunOr404(req.params.module, req.params.runId, res);
  if (!run) return;

  await refreshRunFromJenkins(run);
  const updatedRun = runStore.get(run.module, run.id);

  res.json({
    ok: true,
    data: updatedRun.reports || buildReports(updatedRun)
  });
});
app.post('/api/:module/runs/:runId/stop', async (req, res) => {
  try {
    const run = getRunOr404(req.params.module, req.params.runId, res);
    if (!run) return;

    if (FINAL_STATUSES.has(String(run.status || '').toUpperCase())) {
      return res.status(409).json({
        ok: false,
        message: `Run is already finished with status ${run.status}.`,
        data: run
      });
    }

    if (!run.queueId && !run.buildNumber) {
      return res.status(409).json({
        ok: false,
        message: 'Run does not have a Jenkins queue id or build number yet.',
        data: run
      });
    }

    await stopRunInJenkins(run);

    const now = new Date().toISOString();
    const updatedRun = runStore.update(run.module, run.id, {
      status: 'STOPPING',
      result: 'STOPPING',
      cancellationRequested: true,
      stopRequestedAt: now,
      qaConsole: [
        ...(run.qaConsole || []),
        { timestamp: now, level: 'warn', message: 'Stop requested from dashboard' }
      ]
    });

    res.json({
      ok: true,
      message: 'Stop requested in Jenkins.',
      data: updatedRun
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message
    });
  }
});

function getModuleOr404(moduleId, res) {
  const moduleConfig = getModuleConfig(moduleId);

  if (!moduleConfig) {
    res.status(404).json({ ok: false, message: `Unknown module: ${moduleId}` });
    return null;
  }

  return moduleConfig;
}

function getRunOr404(moduleId, runId, res) {
  const moduleConfig = getModuleOr404(moduleId, res);
  if (!moduleConfig) return null;

  const run = runStore.get(moduleConfig.id, runId);

  if (!run) {
    res.status(404).json({ ok: false, message: `Run not found: ${runId}` });
    return null;
  }

  return run;
}

function ensureModuleOperational(moduleConfig) {
  if (!moduleConfig.enabled) {
    const error = new Error(`Module ${moduleConfig.label} is declared but not operational in this phase.`);
    error.statusCode = 501;
    throw error;
  }
}

function validateRequiredEnv() {
  const missing = [];

  if (!JENKINS_BASE_URL) missing.push('JENKINS_BASE_URL');
  if (!JENKINS_USER) missing.push('JENKINS_USER');
  if (!JENKINS_API_TOKEN) missing.push('JENKINS_API_TOKEN');

  if (missing.length) {
    throw new Error(`Missing Jenkins configuration: ${missing.join(', ')}`);
  }
}

function validateRunParams(params, flow) {
  const required = ['environment', 'platform', 'device', 'region', 'endpointType'];
  const missing = required.filter(key => !params[key] || !String(params[key]).trim());

  if (!flow) missing.push('flow');

  if (missing.length) {
    const error = new Error(`Missing required parameters: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

async function createRun(moduleConfig, params) {
  validateRequiredEnv();

  const flow = resolveFlow(moduleConfig, params.flow, params.folderName || params.folder);
  validateRunParams(params, flow);

  const config = buildRunConfig(moduleConfig, params, flow);
  const now = new Date().toISOString();
  const run = runStore.create({
    module: moduleConfig.id,
    collection: getCollectionLabel(moduleConfig.collectionFile),
    flow: flow.id,
    newmanFolder: flow.folderName,
    status: 'QUEUED',
    result: 'QUEUED',
    jobName: moduleConfig.jobName,
    command: buildCommand(config),
    config,
    executionSteps: [{ id: 'queued', label: 'Queued in Jenkins', status: 'RUNNING', at: now }],
    qaConsole: [{ timestamp: now, level: 'info', message: `${moduleConfig.label} / ${flow.label} queued` }],
    summary: createDefaultSummary(),
    reports: buildReports({ jobName: moduleConfig.jobName, buildNumber: null })
  });

  try {
    const triggered = await triggerJenkinsRun(moduleConfig, run);

    if (!triggered.queueId) {
      throw new Error('Jenkins did not return a valid queue id.');
    }

    const queuedRun = runStore.update(run.module, run.id, {
      queueId: triggered.queueId,
      reports: buildReports(run)
    });

    monitorRun(moduleConfig, queuedRun.id).catch(error => {
      const latestRun = runStore.get(queuedRun.module, queuedRun.id) || queuedRun;
      const wasCancelled = latestRun.cancellationRequested || /cancelled|aborted|stopped/i.test(error.message);
      const status = wasCancelled ? 'STOPPED' : 'FAILURE';

      runStore.update(queuedRun.module, queuedRun.id, {
        status,
        result: status,
        finishedAt: new Date().toISOString(),
        lastError: wasCancelled ? null : error.message
      });
    });

    return queuedRun;
  } catch (error) {
    const failedRun = runStore.update(run.module, run.id, {
      status: 'FAILURE',
      result: 'FAILURE',
      finishedAt: new Date().toISOString(),
      lastError: error.message
    });

    error.run = failedRun;
    throw error;
  }
}

function buildRunConfig(moduleConfig, params, flow) {
  return {
    module: moduleConfig.id,
    moduleLabel: moduleConfig.label,
    jobName: moduleConfig.jobName,
    collectionFile: moduleConfig.collectionFile,
    environmentFile: moduleConfig.environmentFile,
    flow: flow.id,
    flowLabel: flow.label,
    folderName: flow.folderName,
    environment: params.environment,
    platform: params.platform,
    serviceType: params.serviceType || 'ott',
    device: params.device,
    region: params.region,
    endpointType: params.endpointType,
    userFlow: params.userFlow || null,
    dashboardBaseUrl: params.dashboardBaseUrl || JENKINS_DASHBOARD_BASE_URL
  };
}

function buildCommand(config) {
  return [
    `newman run "${config.collectionFile}"`,
    `-e "${config.environmentFile}"`,
    `--folder "${config.folderName}"`,
    '--reporters cli,htmlextra,json',
    '--reporter-htmlextra-export "reports/newman-report.html"',
    '--reporter-json-export "reports/newman-result.json"'
  ].join(' ');
}

async function triggerJenkinsRun(moduleConfig, run) {
  const crumbHeaders = await getJenkinsCrumb();
  const form = new URLSearchParams();
  const config = run.config;

  form.append('module', moduleConfig.id);
  form.append('runId', run.id);
  form.append('collectionFile', config.collectionFile);
  form.append('environmentFile', config.environmentFile);
  form.append('flow', config.flow);
  form.append('folderName', config.folderName);
  form.append('environment', config.environment);
  form.append('platform', config.platform);
  form.append('serviceType', config.serviceType);
  form.append('device', config.device);
  form.append('region', config.region);
  form.append('endpointType', config.endpointType);
  form.append('userFlow', config.userFlow || '');
  form.append('dashboardBaseUrl', config.dashboardBaseUrl);

  const response = await axios.post(`${getJobUrl(moduleConfig.jobName)}/buildWithParameters`, form, {
    auth: getJenkinsAuth(),
    headers: {
      ...crumbHeaders,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    maxRedirects: 0,
    validateStatus: status => status >= 200 && status < 400
  });

  return {
    queueId: extractQueueIdFromLocation(response.headers.location),
    queueLocation: response.headers.location
  };
}

async function monitorRun(moduleConfig, runId) {
  const queuedRun = runStore.get(moduleConfig.id, runId);
  if (!queuedRun) return;

  const build = await waitForBuildNumber(moduleConfig, queuedRun.queueId);
  runStore.update(moduleConfig.id, runId, {
    buildNumber: build.buildNumber,
    buildUrl: build.buildUrl,
    status: 'RUNNING',
    result: 'RUNNING',
    executionSteps: [
      ...queuedRun.executionSteps,
      { id: 'running', label: 'Running Newman folder', status: 'RUNNING', at: new Date().toISOString() }
    ]
  });

  let building = true;

  while (building) {
    await sleep(JENKINS_POLL_INTERVAL_MS);

    const run = runStore.get(moduleConfig.id, runId);
    if (!run) return;

    const buildInfo = await getBuildInfo(run);
    building = Boolean(buildInfo.building);
    const jenkinsStatus = normalizeStatus(buildInfo.result || (building ? 'RUNNING' : 'UNKNOWN'));
    const status = getRunStatusFromJenkins(run, jenkinsStatus, building);

    let patch = {
      status,
      result: status,
      reports: buildReports({ ...run, status })
    };

    if (!building) {
      patch.finishedAt = new Date().toISOString();
      patch.executionSteps = [
        ...run.executionSteps.filter(step => step.id !== 'finished'),
        { id: 'finished', label: 'Execution finished', status, at: patch.finishedAt }
      ];
      patch.qaConsole = [
        ...run.qaConsole,
        { timestamp: patch.finishedAt, level: status === 'SUCCESS' ? 'info' : 'error', message: `Execution finished with ${status}` }
      ];

      const artifactPatch = await getLiveProgressPatchFromJenkinsArtifact({ ...run, ...patch });
      if (artifactPatch) {
        patch = {
          ...patch,
          ...artifactPatch,
          status,
          result: status,
          finishedAt: artifactPatch.finishedAt || patch.finishedAt,
          reports: {
            ...patch.reports,
            ...artifactPatch.reports,
            links: buildReportLinks({ ...run, ...patch, ...artifactPatch })
          }
        };
      }
    }

    runStore.update(moduleConfig.id, runId, patch);
  }
}

async function refreshRunFromJenkins(run) {
  if (!run.buildNumber) {
    return run;
  }

  if (FINAL_STATUSES.has(String(run.status || '').toUpperCase())) {
    if (!run.apiExecutions?.length) {
      const artifactPatch = await getLiveProgressPatchFromJenkinsArtifact(run);

      if (artifactPatch) {
        return runStore.update(run.module, run.id, {
          ...artifactPatch,
          reports: {
            ...run.reports,
            ...artifactPatch.reports,
            links: buildReportLinks({ ...run, ...artifactPatch })
          }
        });
      }
    }

    return run;
  }

  try {
    const buildInfo = await getBuildInfo(run);
    const jenkinsStatus = normalizeStatus(buildInfo.result || (buildInfo.building ? 'RUNNING' : 'UNKNOWN'));
    const status = getRunStatusFromJenkins(run, jenkinsStatus, Boolean(buildInfo.building));
    let patch = {
      status,
      result: status,
      reports: buildReports({ ...run, status })
    };

    if (!buildInfo.building && !run.finishedAt) {
      patch.finishedAt = new Date().toISOString();
    }

    if (!buildInfo.building) {
      const artifactPatch = await getLiveProgressPatchFromJenkinsArtifact({ ...run, ...patch });
      if (artifactPatch) {
        patch = {
          ...patch,
          ...artifactPatch,
          status,
          result: status,
          finishedAt: artifactPatch.finishedAt || patch.finishedAt,
          reports: {
            ...patch.reports,
            ...artifactPatch.reports,
            links: buildReportLinks({ ...run, ...patch, ...artifactPatch })
          }
        };
      }
    }

    return runStore.update(run.module, run.id, patch);
  } catch (error) {
    return runStore.update(run.module, run.id, { lastError: error.message });
  }
}

async function getLiveProgressPatchFromJenkinsArtifact(run) {
  if (!run.buildNumber) return null;

  try {
    const response = await axios.get(`${getJobUrl(run.jobName || run.config.jobName)}/${run.buildNumber}/artifact/reports/live-progress.json`, {
      auth: getJenkinsAuth(),
      responseType: 'json',
      transformResponse: value => value
    });

    const progress = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

    if (!progress || typeof progress !== 'object' || !progress.execution) {
      return null;
    }

    const patch = mapProgressToRun(progress, run);
    const buildNumber = progress.execution?.buildNumber || run.buildNumber;
    const withBuild = {
      ...patch,
      buildNumber,
      buildUrl: buildNumber ? `${getJobUrl(run.jobName || run.config.jobName)}/${buildNumber}/` : run.buildUrl,
      reports: {
        ...run.reports,
        ...patch.reports,
        liveProgress: true
      }
    };

    console.log(
      `[LIVE-PROGRESS] Synced artifact ${run.module}/${run.id} status=${withBuild.status} build=${withBuild.buildNumber || '--'} apis=${withBuild.apiExecutions?.length || 0}`
    );

    return withBuild;
  } catch (error) {
    console.warn(`[LIVE-PROGRESS] Artifact sync skipped for ${run.module}/${run.id}: ${error.message}`);
    return null;
  }
}


function getRunStatusFromJenkins(run, jenkinsStatus, building) {
  if (run.cancellationRequested && building) {
    return 'STOPPING';
  }

  if (run.cancellationRequested && ['ABORTED', 'STOPPED'].includes(jenkinsStatus)) {
    return 'STOPPED';
  }

  return jenkinsStatus;
}

async function stopRunInJenkins(run) {
  if (run.buildNumber) {
    await stopJenkinsBuild(run);
    return;
  }

  if (run.queueId) {
    await cancelJenkinsQueue(run.queueId);
    return;
  }

  const error = new Error('Run does not have a Jenkins queue id or build number.');
  error.statusCode = 409;
  throw error;
}

async function stopJenkinsBuild(run) {
  const crumbHeaders = await getJenkinsCrumb();

  await axios.post(`${getJobUrl(run.jobName || run.config.jobName)}/${run.buildNumber}/stop`, null, {
    auth: getJenkinsAuth(),
    headers: { ...crumbHeaders },
    validateStatus: status => status >= 200 && status < 400
  });
}

async function cancelJenkinsQueue(queueId) {
  const crumbHeaders = await getJenkinsCrumb();

  await axios.post(`${getBaseUrl()}/queue/cancelItem?id=${encodeURIComponent(queueId)}`, null, {
    auth: getJenkinsAuth(),
    headers: { ...crumbHeaders },
    validateStatus: status => status >= 200 && status < 400
  });
}
async function waitForBuildNumber(moduleConfig, queueId) {

  const maxAttempts = 40;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const queueInfo = await getQueueInfo(queueId);

    if (queueInfo.cancelled) {
      throw new Error('Jenkins queue item was cancelled.');
    }

    if (queueInfo.executable && queueInfo.executable.number) {
      return {
        buildNumber: queueInfo.executable.number,
        buildUrl: queueInfo.executable.url || `${getJobUrl(moduleConfig.jobName)}/${queueInfo.executable.number}/`
      };
    }

    await sleep(JENKINS_POLL_INTERVAL_MS);
  }

  throw new Error('Timeout waiting for Jenkins build number.');
}

function buildReports(run) {
  return {
    liveProgress: Boolean(run?.apiExecutions?.length || run?.summary?.total),
    newmanResult: Boolean(run && FINAL_STATUSES.has(String(run.status || '').toUpperCase())),
    newmanReport: Boolean(run && FINAL_STATUSES.has(String(run.status || '').toUpperCase())),
    syncedAt: new Date().toISOString(),
    links: buildReportLinks(run)
  };
}

function buildReportLinks(run) {
  if (!run || !run.buildNumber) {
    return {
      jenkinsBuild: null,
      jenkinsLiveProgress: null,
      jenkinsNewmanHtml: null,
      jenkinsNewmanJson: null
    };
  }

  const jobBuildUrl = `${getJobUrl(run.jobName || run.config.jobName)}/${run.buildNumber}`;

  return {
    jenkinsBuild: `${jobBuildUrl}/`,
    jenkinsLiveProgress: `${jobBuildUrl}/artifact/reports/live-progress.json`,
    jenkinsNewmanHtml: `${jobBuildUrl}/artifact/reports/newman-report.html`,
    jenkinsNewmanJson: `${jobBuildUrl}/artifact/reports/newman-result.json`
  };
}

async function getQueueInfo(queueId) {
  const response = await axios.get(`${getBaseUrl()}/queue/item/${queueId}/api/json`, {
    auth: getJenkinsAuth()
  });

  return response.data;
}

async function getBuildInfo(run) {
  const response = await axios.get(`${getJobUrl(run.jobName || run.config.jobName)}/${run.buildNumber}/api/json`, {
    auth: getJenkinsAuth()
  });

  return response.data;
}

async function getJenkinsCrumb() {
  try {
    const response = await axios.get(`${getBaseUrl()}/crumbIssuer/api/json`, {
      auth: getJenkinsAuth()
    });

    return { [response.data.crumbRequestField]: response.data.crumb };
  } catch (error) {
    return {};
  }
}

function getJenkinsAuth() {
  return {
    username: JENKINS_USER,
    password: JENKINS_API_TOKEN
  };
}

function getBaseUrl() {
  return JENKINS_BASE_URL.replace(/\/$/, '');
}

function getJobUrl(jobName) {
  return `${getBaseUrl()}/job/${encodeURIComponent(jobName)}`;
}

function extractQueueIdFromLocation(location) {
  if (!location) return null;

  const match = location.match(/\/queue\/item\/(\d+)\/?/);
  return match ? match[1] : null;
}

function getDashboardBaseUrlForJenkins(port) {
  const interfaces = os.networkInterfaces();
  const addresses = Object.entries(interfaces)
    .flatMap(([name, items]) => (items || [])
      .filter(item => item.family === 'IPv4' && !item.internal)
      .map(item => ({ name, address: item.address })));

  const preferred = addresses
    .filter(item => !/wsl|docker|virtual|hyper-v|vethernet/i.test(item.name))
    .find(item => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(item.address));

  const fallback = addresses.find(item => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(item.address));
  const selected = preferred || fallback;

  return selected ? `http://${selected.address}:${port}` : `http://host.docker.internal:${port}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(PORT, () => {
  console.log(`QA Dashboard running on http://localhost:${PORT}`);
  console.log('Execution mode: JENKINS / FASE 7 MODULAR');
});
