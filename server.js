require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3000;

const JENKINS_BASE_URL = process.env.JENKINS_BASE_URL;
const JENKINS_JOB_PLAYER = process.env.JENKINS_JOB_PLAYER || 'PLAYER';
const JENKINS_USER = process.env.JENKINS_USER;
const JENKINS_API_TOKEN = process.env.JENKINS_API_TOKEN;
const JENKINS_POLL_INTERVAL_MS = Number(process.env.JENKINS_POLL_INTERVAL_MS || 1500);

const REPORTS_DIR = path.join(__dirname, 'reports');
const LIVE_PROGRESS_PATH = path.join(REPORTS_DIR, 'live-progress.json');

let currentExecution = {
  running: false,
  queueId: null,
  buildNumber: null,
  buildUrl: null,
  jobName: JENKINS_JOB_PLAYER,
  startedAt: null,
  finishedAt: null,
  result: null,
  lastError: null
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/reports', express.static(REPORTS_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live-viewer.html'));
});

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function validateRequiredEnv() {
  const missing = [];

  if (!JENKINS_BASE_URL) missing.push('JENKINS_BASE_URL');
  if (!JENKINS_USER) missing.push('JENKINS_USER');
  if (!JENKINS_API_TOKEN) missing.push('JENKINS_API_TOKEN');

  if (missing.length > 0) {
    throw new Error(`Missing Jenkins configuration: ${missing.join(', ')}`);
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

async function getJenkinsCrumb() {
  try {
    const response = await axios.get(`${getBaseUrl()}/crumbIssuer/api/json`, {
      auth: getJenkinsAuth()
    });

    return {
      [response.data.crumbRequestField]: response.data.crumb
    };
  } catch (error) {
    // Jenkins can be configured without CSRF crumb requirement for API token calls.
    // In that case, continue without crumb.
    return {};
  }
}

function extractQueueIdFromLocation(location) {
  if (!location) return null;

  const match = location.match(/\/queue\/item\/(\d+)\/?/);
  return match ? match[1] : null;
}

function validatePlayerParams(params) {
  const required = [
    'environment',
    'platform',
    'serviceType',
    'device',
    'region',
    'endpointType',
    'folder'
  ];

  const missing = required.filter(key => !params[key] || !String(params[key]).trim());

  if (missing.length > 0) {
    return `Missing required parameters: ${missing.join(', ')}`;
  }

  return null;
}

function buildInitialProgress(params, status = 'QUEUED') {
  return {
    execution: {
      status,
      collection: 'PLAYER',
      buildNumber: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null
    },
    parameters: {
      environment: params.environment || null,
      platform: params.platform || null,
      serviceType: params.serviceType || null,
      device: params.device || null,
      region: params.region || null,
      endpointType: params.endpointType || null,
      folder: params.folder || null,
      userFlow: params.userFlow || null
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

function writeInitialLiveProgress(params) {
  ensureReportsDir();
  fs.writeFileSync(LIVE_PROGRESS_PATH, JSON.stringify(buildInitialProgress(params), null, 2));
}

function readLiveProgressOrDefault() {
  ensureReportsDir();

  if (!fs.existsSync(LIVE_PROGRESS_PATH)) {
    return buildInitialProgress({}, 'CLEARED');
  }

  try {
    return JSON.parse(fs.readFileSync(LIVE_PROGRESS_PATH, 'utf8'));
  } catch (error) {
    return buildInitialProgress({}, 'UNKNOWN');
  }
}

function writeLiveProgress(data) {
  ensureReportsDir();
  fs.writeFileSync(LIVE_PROGRESS_PATH, JSON.stringify(data, null, 2));
}

function markLiveProgressStatus(status, extraExecution = {}) {
  const data = readLiveProgressOrDefault();

  data.execution = data.execution || {};
  data.execution.status = status;
  data.execution.collection = data.execution.collection || 'PLAYER';
  data.execution.buildNumber = currentExecution.buildNumber || data.execution.buildNumber || null;
  data.execution.finishedAt = ['SUCCESS', 'FAILURE', 'STOPPED', 'ABORTED'].includes(status)
    ? new Date().toISOString()
    : data.execution.finishedAt || null;

  Object.assign(data.execution, extraExecution);

  if (data.execution.startedAt && data.execution.finishedAt) {
    data.execution.durationMs = new Date(data.execution.finishedAt) - new Date(data.execution.startedAt);
  }

  data.summary = data.summary || {};

  if (status === 'STOPPED') {
    data.summary.currentApi = 'Execution stopped by user';
  }

  writeLiveProgress(data);
}

async function triggerPlayerBuild(params) {
  validateRequiredEnv();

  const crumbHeaders = await getJenkinsCrumb();
  const form = new URLSearchParams();

  form.append('COLLECTION', 'PLAYER');
  form.append('environment', params.environment);
  form.append('platform', params.platform);
  form.append('serviceType', params.serviceType);
  form.append('device', params.device);
  form.append('region', params.region);
  form.append('endpointType', params.endpointType);
  form.append('folder', params.folder);
  form.append('userFlow', params.userFlow || '');

  const response = await axios.post(
    `${getJobUrl(JENKINS_JOB_PLAYER)}/buildWithParameters`,
    form,
    {
      auth: getJenkinsAuth(),
      headers: {
        ...crumbHeaders,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400
    }
  );

  const queueLocation = response.headers.location;
  const queueId = extractQueueIdFromLocation(queueLocation);

  return {
    queueId,
    queueLocation
  };
}

async function getQueueInfo(queueId) {
  const response = await axios.get(`${getBaseUrl()}/queue/item/${queueId}/api/json`, {
    auth: getJenkinsAuth()
  });

  return response.data;
}

async function getBuildInfo(buildNumber) {
  const response = await axios.get(`${getJobUrl(JENKINS_JOB_PLAYER)}/${buildNumber}/api/json`, {
    auth: getJenkinsAuth()
  });

  return response.data;
}

async function waitForBuildNumber(queueId) {
  const maxAttempts = 40;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const queueInfo = await getQueueInfo(queueId);

    if (queueInfo.cancelled) {
      throw new Error('Jenkins queue item was cancelled.');
    }

    if (queueInfo.executable && queueInfo.executable.number) {
      return {
        buildNumber: queueInfo.executable.number,
        buildUrl: queueInfo.executable.url
      };
    }

    await new Promise(resolve => setTimeout(resolve, JENKINS_POLL_INTERVAL_MS));
  }

  throw new Error('Timeout waiting for Jenkins build number.');
}

async function monitorBuild(buildNumber) {
  try {
    let building = true;

    while (building) {
      const buildInfo = await getBuildInfo(buildNumber);
      building = Boolean(buildInfo.building);

      currentExecution.running = building;
      currentExecution.result = buildInfo.result || 'RUNNING';

      if (!building) {
        currentExecution.running = false;
        currentExecution.finishedAt = new Date().toISOString();
        currentExecution.result = buildInfo.result || 'UNKNOWN';
        break;
      }

      await new Promise(resolve => setTimeout(resolve, JENKINS_POLL_INTERVAL_MS));
    }
  } catch (error) {
    currentExecution.running = false;
    currentExecution.lastError = error.message;
  }
}

async function stopJenkinsBuild(buildNumber) {
  const crumbHeaders = await getJenkinsCrumb();

  await axios.post(`${getJobUrl(JENKINS_JOB_PLAYER)}/${buildNumber}/stop`, null, {
    auth: getJenkinsAuth(),
    headers: {
      ...crumbHeaders
    },
    validateStatus: status => status >= 200 && status < 400
  });
}

async function cancelJenkinsQueue(queueId) {
  const crumbHeaders = await getJenkinsCrumb();

  await axios.post(`${getBaseUrl()}/queue/cancelItem?id=${encodeURIComponent(queueId)}`, null, {
    auth: getJenkinsAuth(),
    headers: {
      ...crumbHeaders
    },
    validateStatus: status => status >= 200 && status < 400
  });
}

function clearReports() {
  ensureReportsDir();

  const emptyProgress = {
    execution: {
      status: 'CLEARED',
      collection: 'PLAYER',
      buildNumber: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null
    },
    parameters: {
      environment: null,
      platform: null,
      serviceType: null,
      device: null,
      region: null,
      endpointType: null,
      folder: null,
      userFlow: null
    },
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      currentApi: null
    },
    apis: []
  };

  writeLiveProgress(emptyProgress);

  const filesToDelete = [
    path.join(REPORTS_DIR, 'newman-result.json'),
    path.join(REPORTS_DIR, 'newman-report.html')
  ];

  filesToDelete.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
}

app.get('/status', async (req, res) => {
  res.json({
    server: 'OK',
    mode: 'JENKINS',
    execution: currentExecution
  });
});

app.post('/run/player', async (req, res) => {
  try {
    const params = req.body;
    const validationError = validatePlayerParams(params);

    if (validationError) {
      return res.status(400).json({
        ok: false,
        message: validationError
      });
    }

    if (currentExecution.running) {
      return res.status(409).json({
        ok: false,
        message: 'A PLAYER regression is already running.',
        execution: currentExecution
      });
    }

    writeInitialLiveProgress(params);

    currentExecution = {
      running: true,
      queueId: null,
      buildNumber: null,
      buildUrl: null,
      jobName: JENKINS_JOB_PLAYER,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: 'QUEUED',
      lastError: null
    };

    const triggered = await triggerPlayerBuild(params);

    currentExecution.queueId = triggered.queueId;
    currentExecution.result = 'QUEUED';

    if (!triggered.queueId) {
      throw new Error('Jenkins did not return a valid queue id.');
    }

    waitForBuildNumber(triggered.queueId)
      .then(({ buildNumber, buildUrl }) => {
        currentExecution.buildNumber = buildNumber;
        currentExecution.buildUrl = buildUrl;
        currentExecution.result = 'RUNNING';
        markLiveProgressStatus('RUNNING', { buildNumber });
        monitorBuild(buildNumber);
      })
      .catch(error => {
        currentExecution.running = false;
        currentExecution.result = 'FAILURE';
        currentExecution.lastError = error.message;
        markLiveProgressStatus('FAILURE', { errorMessage: error.message });
      });

    return res.status(202).json({
      ok: true,
      message: 'PLAYER regression queued in Jenkins.',
      execution: currentExecution
    });
  } catch (error) {
    currentExecution.running = false;
    currentExecution.result = 'FAILURE';
    currentExecution.lastError = error.message;
    markLiveProgressStatus('FAILURE', { errorMessage: error.message });

    return res.status(500).json({
      ok: false,
      message: error.message,
      execution: currentExecution
    });
  }
});

app.post('/stop/player', async (req, res) => {
  try {
    if (!currentExecution.running && !currentExecution.queueId && !currentExecution.buildNumber) {
      return res.status(409).json({
        ok: false,
        message: 'There is no PLAYER execution running or queued.',
        execution: currentExecution
      });
    }

    if (currentExecution.buildNumber) {
      await stopJenkinsBuild(currentExecution.buildNumber);
    } else if (currentExecution.queueId) {
      await cancelJenkinsQueue(currentExecution.queueId);
    }

    currentExecution.running = false;
    currentExecution.result = 'STOPPED';
    currentExecution.finishedAt = new Date().toISOString();

    markLiveProgressStatus('STOPPED', { stoppedBy: 'dashboard' });

    return res.json({
      ok: true,
      message: 'PLAYER execution stopped.',
      execution: currentExecution
    });
  } catch (error) {
    currentExecution.lastError = error.message;

    return res.status(500).json({
      ok: false,
      message: error.message,
      execution: currentExecution
    });
  }
});

app.post('/clear/player', async (req, res) => {
  try {
    if (currentExecution.running) {
      return res.status(409).json({
        ok: false,
        message: 'Cannot clear reports while PLAYER execution is running. Stop it first.',
        execution: currentExecution
      });
    }

    clearReports();

    currentExecution = {
      running: false,
      queueId: null,
      buildNumber: null,
      buildUrl: null,
      jobName: JENKINS_JOB_PLAYER,
      startedAt: null,
      finishedAt: null,
      result: 'CLEARED',
      lastError: null
    };

    return res.json({
      ok: true,
      message: 'PLAYER reports cleared.',
      execution: currentExecution
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      execution: currentExecution
    });
  }
});

app.get('/jenkins/build', async (req, res) => {
  try {
    if (!currentExecution.buildNumber) {
      return res.status(404).json({
        ok: false,
        message: 'No Jenkins build number available yet.',
        execution: currentExecution
      });
    }

    const buildInfo = await getBuildInfo(currentExecution.buildNumber);

    res.json({
      ok: true,
      build: {
        number: buildInfo.number,
        building: buildInfo.building,
        result: buildInfo.result,
        url: buildInfo.url,
        timestamp: buildInfo.timestamp,
        duration: buildInfo.duration
      }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`QA Dashboard server running on http://localhost:${PORT}`);
  console.log('Execution mode: JENKINS');
});
