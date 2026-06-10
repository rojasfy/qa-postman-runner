const RUN_INTERVAL_MS = 1500;
const FINAL_SETTLE_POLLS = 6;
const FINAL_STATUSES = ['SUCCESS', 'FAILURE', 'STOPPED', 'ABORTED', 'CLEARED', 'UNKNOWN'];

let selectedApiId = null;
let refreshTimer = null;
let currentModule = 'ply';
let currentRunId = null;
let lastRun = null;
let lastReports = null;
let stoppingRunId = null;
let finalSettlePolls = 0;

const form = document.getElementById('runForm');
const moduleSelect = document.getElementById('moduleSelect');
const flowSelect = document.getElementById('flowSelect');
const runButton = document.getElementById('runButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const refreshButton = document.getElementById('refreshButton');
const serverStatus = document.getElementById('serverStatus');
const jobStatus = document.getElementById('jobStatus');
const reportLinks = document.getElementById('reportLinks');
const reportSyncStatus = document.getElementById('reportSyncStatus');

form.addEventListener('submit', async event => {
  event.preventDefault();

  const payload = Object.fromEntries(new FormData(form).entries());
  const moduleId = payload.module;
  delete payload.module;

  selectedApiId = null;
  currentModule = moduleId;
  finalSettlePolls = 0;

  setRunningUi(true, 'QUEUED');
  clearDashboardView('Run enviado a Jenkins. Esperando progreso...');

  try {
    const response = await fetch(`/api/${encodeURIComponent(moduleId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Could not trigger Jenkins job.');
    }

    currentRunId = data.data?.id;
    lastRun = data.data || null;

    if (!currentRunId) {
      throw new Error('Backend did not return a run id.');
    }

    renderRun(lastRun);
    setRunningUi(true, lastRun.status || 'QUEUED');
    startLiveRefresh();
  } catch (error) {
    alert(error.message);
    setRunningUi(false);
    renderJobStatus({ status: 'FAILURE', lastError: error.message });
  }
});

moduleSelect.addEventListener('change', async () => {
  currentModule = moduleSelect.value;
  currentRunId = null;
  finalSettlePolls = 0;
  stopLiveRefresh();
  clearDashboardView();
  await loadFlows(currentModule);
});

stopButton.addEventListener('click', async () => {
  if (!currentModule || !currentRunId || !lastRun || isFinal(lastRun.status)) {
    return;
  }

  const confirmStop = confirm('Deseas detener la ejecucion actual en Jenkins?');
  if (!confirmStop) return;

  stoppingRunId = currentRunId;
  setRunningUi(true, 'STOPPING');

  try {
    const response = await fetch(`/api/${encodeURIComponent(currentModule)}/runs/${encodeURIComponent(currentRunId)}/stop`, {
      method: 'POST'
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'No se pudo detener la ejecucion.');
    }

    lastRun = data.data || lastRun;
    renderRun(lastRun);
    await refreshRun();
  } catch (error) {
    alert(error.message);
    stoppingRunId = null;
    setRunningUi(!isFinal(lastRun?.status), lastRun?.status || 'RUNNING');
  }
});

clearButton.addEventListener('click', () => {
  stopLiveRefresh();
  selectedApiId = null;
  currentRunId = null;
  lastRun = null;
  lastReports = null;
  finalSettlePolls = 0;
  clearDashboardView('Resultados limpiados.');
  renderJobStatus(null);
  setRunningUi(false);
});

refreshButton.addEventListener('click', async () => {
  if (currentRunId) {
    await refreshRun();
  } else {
    await refreshLatestRun();
  }
});

async function initDashboard() {
  try {
    await loadModules();
    await loadFlows(currentModule);
    await refreshLatestRun();
    serverStatus.textContent = 'SERVER: OK / FASE 7';
    serverStatus.className = 'pill pill-passed';
  } catch (error) {
    serverStatus.textContent = 'SERVER: ERROR';
    serverStatus.className = 'pill pill-failed';
    console.error(error);
  }
}

async function loadModules() {
  const response = await fetch('/api/modules?cache=' + Date.now());
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Could not load modules.');
  }

  const modules = data.data || [];
  moduleSelect.innerHTML = modules.map(module => {
    const selected = module.id === currentModule ? ' selected' : '';
    const disabled = module.enabled ? '' : ' disabled';
    const suffix = module.enabled ? '' : ' (pendiente)';
    return `<option value="${escapeHtml(module.id)}"${selected}${disabled}>${escapeHtml(module.label + suffix)}</option>`;
  }).join('');

  if (!modules.some(module => module.id === currentModule && module.enabled)) {
    const firstEnabled = modules.find(module => module.enabled);
    currentModule = firstEnabled?.id || 'ply';
    moduleSelect.value = currentModule;
  }
}

async function loadFlows(moduleId) {
  flowSelect.disabled = true;
  flowSelect.innerHTML = '<option value="">Cargando...</option>';

  const response = await fetch(`/api/${encodeURIComponent(moduleId)}/flows?cache=${Date.now()}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    flowSelect.innerHTML = '<option value="">Sin flujos</option>';
    runButton.disabled = true;
    throw new Error(data.message || 'Could not load flows.');
  }

  const flows = data.data || [];

  if (!data.enabled || flows.length === 0) {
    flowSelect.innerHTML = '<option value="">Modulo no operativo</option>';
    flowSelect.disabled = true;
    runButton.disabled = true;
    return;
  }

  flowSelect.innerHTML = flows.map(flow => (
    `<option value="${escapeHtml(flow.id)}">${escapeHtml(flow.label || flow.folderName || flow.id)}</option>`
  )).join('');

  flowSelect.disabled = false;
  runButton.disabled = false;
}

function startLiveRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);

  refreshRun();
  refreshTimer = setInterval(refreshRun, RUN_INTERVAL_MS);
}

function stopLiveRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function refreshLatestRun() {
  try {
    const response = await fetch(`/api/${encodeURIComponent(currentModule)}/runs?cache=${Date.now()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) return;

    const latestRun = (data.data || [])[0];
    if (!latestRun) {
      renderJobStatus(null);
      renderReportLinks({});
      return;
    }

    currentRunId = latestRun.id;
    lastRun = latestRun;
    renderRun(latestRun);

    if (!isFinal(latestRun.status)) {
      finalSettlePolls = 0;
      startLiveRefresh();
    }
  } catch (error) {
    console.error('Error loading latest run', error);
  }
}

async function refreshRun() {
  if (!currentModule || !currentRunId) return;

  try {
    const [statusResponse, progressResponse, reportsResponse] = await Promise.all([
      fetch(`/api/${encodeURIComponent(currentModule)}/runs/${encodeURIComponent(currentRunId)}/status?cache=${Date.now()}`),
      fetch(`/api/${encodeURIComponent(currentModule)}/runs/${encodeURIComponent(currentRunId)}/progress?cache=${Date.now()}`),
      fetch(`/api/${encodeURIComponent(currentModule)}/runs/${encodeURIComponent(currentRunId)}/reports?cache=${Date.now()}`)
    ]);

    const statusData = await statusResponse.json();
    const progressData = await progressResponse.json();
    const reportsData = await reportsResponse.json();

    if (!statusResponse.ok || !statusData.ok) {
      throw new Error(statusData.message || 'Could not refresh run status.');
    }

    lastRun = mergeRunProgress(statusData.data, progressData.ok ? progressData.data : null);
    lastReports = reportsData.ok ? reportsData.data : lastRun.reports;

    renderRun(lastRun);
    renderReportLinks({ ...lastRun, reports: lastReports });

    if (isFinal(lastRun.status)) {
      stoppingRunId = null;
      setRunningUi(false, lastRun.status);

      if (hasRenderableProgress(lastRun) || finalSettlePolls >= FINAL_SETTLE_POLLS) {
        stopLiveRefresh();
      } else {
        finalSettlePolls++;
      }
    } else {
      finalSettlePolls = 0;
      setRunningUi(true, lastRun.status);
    }
  } catch (error) {
    serverStatus.textContent = 'SERVER: ERROR';
    serverStatus.className = 'pill pill-failed';
    console.error('Error refreshing run', error);
  }
}

function hasRenderableProgress(run = {}) {
  return Boolean((run.apiExecutions || []).length || run.summary?.total);
}

function mergeRunProgress(run, progress) {
  if (!progress) return run;

  return {
    ...run,
    status: progress.status || run.status,
    summary: progress.summary || run.summary,
    apiExecutions: progress.apiExecutions || run.apiExecutions,
    executionSteps: progress.executionSteps || run.executionSteps,
    qaConsole: progress.qaConsole || run.qaConsole,
    startedAt: progress.startedAt || run.startedAt,
    finishedAt: progress.finishedAt || run.finishedAt
  };
}

function setRunningUi(isRunning, status = null) {
  const normalized = String(status || '').toUpperCase();
  const isStopping = normalized === 'STOPPING' || stoppingRunId === currentRunId;

  runButton.disabled = isRunning || flowSelect.disabled;
  stopButton.disabled = !isRunning || isStopping || !currentRunId;
  clearButton.disabled = false;

  runButton.innerHTML = isRunning ? '...' : '&#9654;';
  stopButton.innerHTML = isStopping ? '...' : '&#9632;';

  if (status) {
    jobStatus.className = `pill ${statusToPillClass(status)}`;
  }
}

function renderRun(run) {
  if (!run) {
    renderJobStatus(null);
    renderExecution({});
    renderSummary({});
    renderParameters({});
    renderApis([]);
    renderReportLinks({});
    return;
  }

  renderJobStatus(run);
  renderExecution(run);
  renderSummary(run.summary || {});
  renderParameters(run.config || {});
  renderApis(run.apiExecutions || []);
  renderReportLinks(run);
}

function renderJobStatus(run) {
  if (!run) {
    jobStatus.textContent = 'JENKINS: IDLE';
    jobStatus.className = 'pill pill-muted';
    return;
  }

  const result = run.status || run.result || 'IDLE';
  const buildNumber = run.buildNumber ? ` #${run.buildNumber}` : '';
  const runSuffix = run.id ? ` / ${run.id.slice(0, 8)}` : '';

  jobStatus.textContent = `JENKINS: ${result}${buildNumber}${runSuffix}`;
  jobStatus.className = `pill ${statusToPillClass(result)}`;
}

function renderReportLinks(run = {}) {
  if (!reportLinks || !reportSyncStatus) return;

  const result = String(run.status || run.result || '').toUpperCase();
  const reports = run.reports || {};
  const links = reports.links || {};
  const hasBuild = Boolean(run.buildNumber);
  const isFinalStatus = isFinal(result);

  reportSyncStatus.textContent = reports.syncedAt
    ? `SYNC ${formatDate(reports.syncedAt)}`
    : (hasBuild ? `BUILD #${run.buildNumber}` : '--');

  if (!hasBuild) {
    reportLinks.innerHTML = '<div class="empty-state">Los enlaces se habilitan cuando Jenkins asigna un build.</div>';
    return;
  }

  const items = [
    { label: 'Build Jenkins', href: links.jenkinsBuild },
    { label: 'Live progress', href: links.jenkinsLiveProgress },
    { label: 'Newman HTML', href: links.jenkinsNewmanHtml, disabled: !isFinalStatus && !reports.newmanReport },
    { label: 'Newman JSON', href: links.jenkinsNewmanJson, disabled: !isFinalStatus && !reports.newmanResult }
  ];

  reportLinks.innerHTML = items.map(item => {
    if (!item.href || item.disabled) {
      return `<span class="report-link disabled">${escapeHtml(item.label)}</span>`;
    }

    return `<a class="report-link" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`;
  }).join('');
}

function renderExecution(run) {
  document.getElementById('metricCollection').textContent = run.collection || run.config?.moduleLabel || '--';
  document.getElementById('metaStarted').textContent = formatDate(run.startedAt);
  document.getElementById('metaFinished').textContent = formatDate(run.finishedAt);
  document.getElementById('metaDuration').textContent = formatDuration(getDurationMs(run));
}

function renderSummary(summary) {
  document.getElementById('metricTotal').textContent = summary.total ?? 0;
  document.getElementById('metricPassed').textContent = summary.passed ?? 0;
  document.getElementById('metricFailed').textContent = summary.failed ?? 0;
  document.getElementById('metaCurrentApi').textContent = summary.currentApi || '--';
}

function renderParameters(parameters) {
  document.getElementById('parametersPanel').textContent = pretty(parameters);
}

function isVisibleServiceRequest(api) {
  const value = api?.url || api?.path || '';
  return String(value).toLowerCase().includes('/services/');
}

function renderApis(apis) {
  apis = (apis || []).filter(isVisibleServiceRequest);

  const apiList = document.getElementById('apiList');
  const apiCounter = document.getElementById('apiCounter');

  apiCounter.textContent = String(apis.length);
  apiList.innerHTML = '';

  if (!apis.length) {
    apiList.innerHTML = '<div class="empty-state">Sin APIs ejecutadas todavia.</div>';
    clearDetail();
    return;
  }

  if (!selectedApiId || !apis.some(api => getApiId(api) === selectedApiId)) {
    selectedApiId = getApiId(apis[0]);
  }

  apis.forEach(api => {
    const item = document.createElement('button');
    const apiId = getApiId(api);

    item.type = 'button';
    item.className = `api-item ${apiId === selectedApiId ? 'active' : ''}`;
    item.innerHTML = `
      <span class="api-name">${escapeHtml(api.name || 'Unnamed API')}</span>
      <span class="api-meta">
        <span>${escapeHtml(api.method || '--')}</span>
        <span>${api.statusCode || api.response?.statusCode || '--'}</span>
        <span>${api.responseTime || api.response?.timeMs || '--'} ms</span>
      </span>
      <span class="pill ${statusToPillClass(api.status)}">${escapeHtml(api.status || '--')}</span>
    `;

    item.addEventListener('click', () => {
      selectedApiId = apiId;
      renderApis(apis);
    });

    apiList.appendChild(item);
  });

  const selectedApi = apis.find(api => getApiId(api) === selectedApiId);
  renderDetail(selectedApi);
}

function renderDetail(api) {
  if (!api) {
    clearDetail();
    return;
  }

  document.getElementById('detailTitle').textContent = api.name || 'Detalle';
  document.getElementById('detailStatus').textContent = api.status || '--';
  document.getElementById('detailStatus').className = `pill ${statusToPillClass(api.status)}`;
  document.getElementById('detailUrl').textContent = api.url || '--';

  document.getElementById('requestHeaders').textContent = pretty(api.request?.headers || {});
  document.getElementById('requestBody').textContent = pretty(api.request?.body ?? null);
  document.getElementById('responseHeaders').textContent = pretty(api.response?.headers || {});
  document.getElementById('responseBody').textContent = pretty(api.response?.body ?? {});

  renderAssertions(api.assertions || []);
}

function renderAssertions(assertions) {
  const assertionsPanel = document.getElementById('assertionsPanel');
  assertionsPanel.innerHTML = '';

  if (!assertions.length) {
    assertionsPanel.innerHTML = '<div class="empty-state">Sin assertions registradas.</div>';
    return;
  }

  assertions.forEach(assertion => {
    const row = document.createElement('div');
    row.className = 'assertion-row';
    row.innerHTML = `
      <span class="pill ${statusToPillClass(assertion.status)}">${escapeHtml(assertion.status || '--')}</span>
      <strong>${escapeHtml(assertion.name || 'Unnamed assertion')}</strong>
      ${assertion.errorMessage ? `<p>${escapeHtml(assertion.errorMessage)}</p>` : ''}
    `;
    assertionsPanel.appendChild(row);
  });
}

function clearDashboardView(message = 'Sin APIs ejecutadas todavia.') {
  document.getElementById('apiList').innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  document.getElementById('apiCounter').textContent = '0';
  document.getElementById('metricCollection').textContent = '--';
  document.getElementById('metricTotal').textContent = '0';
  document.getElementById('metricPassed').textContent = '0';
  document.getElementById('metricFailed').textContent = '0';
  document.getElementById('metaStarted').textContent = '--';
  document.getElementById('metaFinished').textContent = '--';
  document.getElementById('metaDuration').textContent = '--';
  document.getElementById('metaCurrentApi').textContent = '--';
  document.getElementById('parametersPanel').textContent = '{}';
  renderReportLinks({});
  clearDetail();
}

function clearDetail() {
  document.getElementById('detailTitle').textContent = 'Detalle';
  document.getElementById('detailStatus').textContent = '--';
  document.getElementById('detailStatus').className = 'pill pill-muted';
  document.getElementById('detailUrl').textContent = 'Selecciona una API para ver el detalle.';
  document.getElementById('requestHeaders').textContent = '{}';
  document.getElementById('requestBody').textContent = 'null';
  document.getElementById('responseHeaders').textContent = '{}';
  document.getElementById('responseBody').textContent = '{}';
  document.getElementById('assertionsPanel').innerHTML = '<div class="empty-state">Sin assertions registradas.</div>';
}

function getApiId(api) {
  return String(api.id || api.itemId || `${api.name}-${api.executedAt}`);
}

function isFinal(status = '') {
  return FINAL_STATUSES.includes(String(status).toUpperCase());
}

function getDurationMs(run = {}) {
  if (run.durationMs || run.durationMs === 0) return run.durationMs;
  if (!run.startedAt || !run.finishedAt) return null;

  return new Date(run.finishedAt) - new Date(run.startedAt);
}

function pretty(value) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch (_) {
      return value;
    }
  }

  return JSON.stringify(value, null, 2);
}

function formatDate(value) {
  if (!value) return '--';

  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return value;
  }
}

function formatDuration(value) {
  if (!value && value !== 0) return '--';

  const seconds = Math.round(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

function statusToPillClass(status = '') {
  const normalized = String(status).toUpperCase();

  if (['SUCCESS', 'PASSED'].includes(normalized)) return 'pill-passed';
  if (['FAILURE', 'FAILED'].includes(normalized)) return 'pill-failed';
  if (['RUNNING', 'QUEUED', 'BUILDING'].includes(normalized)) return 'pill-running';
  if (['STOPPING'].includes(normalized)) return 'pill-stopped';
  if (['STOPPED', 'ABORTED'].includes(normalized)) return 'pill-stopped';
  if (['CLEARED'].includes(normalized)) return 'pill-muted';

  return 'pill-muted';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

initDashboard();
