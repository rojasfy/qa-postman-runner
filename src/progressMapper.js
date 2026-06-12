const FINAL_STATUSES = new Set(['SUCCESS', 'FAILURE', 'ABORTED', 'STOPPED', 'CLEARED', 'UNKNOWN']);

function normalizeStatus(value) {
  const status = String(value || 'UNKNOWN').toUpperCase();

  if (status === 'PASSED') return 'SUCCESS';
  if (status === 'FAILED') return 'FAILURE';
  if (status === 'BUILDING') return 'RUNNING';

  return status;
}

function isFinalStatus(status) {
  return FINAL_STATUSES.has(normalizeStatus(status));
}

function isVisibleServiceRequest(api) {
  const value = api?.url || api?.path || '';
  return String(value).toLowerCase().includes('/services/');
}

function mapApi(api) {
  const status = normalizeStatus(api.status);
  const url = api.url || api.path || null;

  return {
    id: String(api.id || api.itemId || `${api.name || 'api'}-${api.executedAt || Date.now()}`),
    itemId: api.itemId || null,
    name: api.name || 'Unnamed API',
    method: api.method || null,
    url,
    status,
    statusCode: api.statusCode || null,
    statusText: api.statusText || null,
    responseTime: api.responseTime || null,
    executedAt: api.executedAt || null,
    request: {
      headers: api.request?.headers || {},
      body: api.request?.body ?? null,
      bodyTruncated: Boolean(api.request?.bodyTruncated),
      originalBodySize: api.request?.originalBodySize || null
    },
    response: {
      statusCode: api.statusCode || api.response?.statusCode || null,
      statusText: api.statusText || api.response?.statusText || null,
      timeMs: api.responseTime || api.response?.timeMs || null,
      headers: api.response?.headers || {},
      body: api.response?.body ?? null,
      bodyTruncated: Boolean(api.response?.bodyTruncated),
      originalBodySize: api.response?.originalBodySize || null
    },
    assertions: (api.assertions || []).map(assertion => ({
      name: assertion.name || 'Unnamed assertion',
      status: normalizeStatus(assertion.status),
      errorMessage: assertion.errorMessage || null,
      executedAt: assertion.executedAt || null
    }))
  };
}

function buildExecutionSteps(run, progress, status) {
  const steps = [
    {
      id: 'queued',
      label: 'Queued in Jenkins',
      status: run.queueId || run.buildNumber || status !== 'QUEUED' ? 'SUCCESS' : 'RUNNING',
      at: run.startedAt
    },
    {
      id: 'running',
      label: 'Running Newman folder',
      status: status === 'QUEUED' ? 'PENDING' : (isFinalStatus(status) ? 'SUCCESS' : 'RUNNING'),
      at: progress.execution?.startedAt || run.startedAt
    }
  ];

  if (isFinalStatus(status)) {
    steps.push({
      id: 'finished',
      label: 'Execution finished',
      status,
      at: progress.execution?.finishedAt || run.finishedAt || new Date().toISOString()
    });
  }

  return steps;
}

function buildQaConsole(progress, run, status) {
  const lines = [
    {
      timestamp: run.startedAt,
      level: 'info',
      message: `${run.module.toUpperCase()} / ${run.flow || run.newmanFolder} queued`
    }
  ];

  if (run.buildNumber || progress.execution?.buildNumber) {
    lines.push({
      timestamp: progress.execution?.startedAt || run.startedAt,
      level: 'info',
      message: `Jenkins build #${run.buildNumber || progress.execution.buildNumber}`
    });
  }

  (progress.apis || []).filter(isVisibleServiceRequest).slice(-30).forEach(api => {
    lines.push({
      timestamp: api.executedAt || new Date().toISOString(),
      level: normalizeStatus(api.status) === 'FAILURE' ? 'error' : 'info',
      message: `${api.method || '--'} ${api.name || api.url || 'API'} | ${api.statusCode || '--'} | ${api.responseTime || '--'}ms | ${normalizeStatus(api.status)}`
    });
  });

  if (isFinalStatus(status)) {
    lines.push({
      timestamp: progress.execution?.finishedAt || run.finishedAt || new Date().toISOString(),
      level: status === 'SUCCESS' ? 'info' : 'error',
      message: `Execution finished with ${status}`
    });
  }

  return lines;
}

function mapProgressToRun(progress, run) {
  const execution = progress.execution || {};
  const status = normalizeStatus(execution.status || run.status || 'RUNNING');
  const rawApis = Array.isArray(progress.apis)
    ? progress.apis
    : (Array.isArray(progress.apiExecutions) ? progress.apiExecutions : []);
  const apiExecutions = rawApis.filter(isVisibleServiceRequest).map(mapApi);
  const summary = {
    total: apiExecutions.length,
    passed: apiExecutions.filter(api => api.status === 'SUCCESS').length,
    failed: apiExecutions.filter(api => api.status === 'FAILURE').length,
    currentApi: apiExecutions.length ? apiExecutions[apiExecutions.length - 1].name : null
  };

  const finishedAt = execution.finishedAt || (isFinalStatus(status) ? run.finishedAt || new Date().toISOString() : null);

  return {
    status,
    result: status,
    buildNumber: execution.buildNumber || run.buildNumber || null,
    buildUrl: run.buildUrl,
    startedAt: execution.startedAt || run.startedAt,
    finishedAt,
    summary,
    apiExecutions,
    executionSteps: buildExecutionSteps(run, progress, status),
    qaConsole: buildQaConsole(progress, run, status),
    reports: {
      ...run.reports,
      liveProgress: true,
      syncedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  normalizeStatus,
  isFinalStatus,
  mapProgressToRun
};
