const RUN_INTERVAL_MS = 1500;

let selectedApiId = null;
let refreshTimer = null;
let lastProgress = null;
let lastExecution = null;

const form = document.getElementById('runForm');
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

  setRunningUi(true, 'QUEUED');
  runButton.textContent = '...';

  try {
    const response = await fetch('/run/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Could not trigger Jenkins job.');
    }

    renderJobStatus(data.execution);
    startLiveRefresh();
  } catch (error) {
    alert(error.message);
    setRunningUi(false);
  }
});

stopButton.addEventListener('click', async () => {
  const confirmStop = confirm('¿Deseas detener la ejecución PLAYER actual?');

  if (!confirmStop) return;

  stopButton.disabled = true;
  stopButton.textContent = '...';

  try {
    const response = await fetch('/stop/player', { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'No se pudo detener la ejecución.');
    }

    renderJobStatus(data.execution);
    await refreshLiveProgress();
    setRunningUi(false);
  } catch (error) {
    alert(error.message);
  } finally {
    stopButton.textContent = '■';
  }
});

clearButton.addEventListener('click', async () => {
  const confirmClear = confirm('¿Deseas limpiar los resultados renderizados?');

  if (!confirmClear) return;

  try {
    const response = await fetch('/clear/player', { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'No se pudieron limpiar los resultados.');
    }

    selectedApiId = null;
    lastProgress = null;

    await refreshStatus();
    await refreshLiveProgress();
    clearDashboardView();
  } catch (error) {
    alert(error.message);
  }
});

refreshButton.addEventListener('click', async () => {
  await refreshStatus();
  await refreshLiveProgress();
});

function startLiveRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);

  refreshStatus();
  refreshLiveProgress();

  refreshTimer = setInterval(async () => {
    await refreshStatus();
    await refreshLiveProgress();
  }, RUN_INTERVAL_MS);
}

function stopLiveRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
async function refreshStatus() {
  try {
    const response = await fetch('/status?cache=' + Date.now());
    const data = await response.json();

    serverStatus.textContent = `SERVER: ${data.server || 'OK'} / ${data.mode || '--'}`;
    lastExecution = data.execution || null;
    renderJobStatus(data.execution);
    renderReportLinks(data.execution);

    const isRunning = data.execution?.running === true;
    const result = data.execution?.result;
    setRunningUi(isRunning, result);

    if (!isRunning && ['SUCCESS', 'FAILURE', 'STOPPED', 'ABORTED'].includes(String(result).toUpperCase())) {
      stopLiveRefresh();
    }
  } catch (error) {
    serverStatus.textContent = 'SERVER: ERROR';
    serverStatus.className = 'pill pill-failed';
  }
}

async function refreshLiveProgress() {
  try {
    const response = await fetch('/reports/live-progress.json?cache=' + Date.now());

    if (!response.ok) return;

    const progress = await response.json();
    lastProgress = progress;

    renderExecution(progress.execution || {});
    renderSummary(progress.summary || {});
    renderParameters(progress.parameters || {});
    renderApis(progress.apis || []);
    renderReportLinks({
      result: progress.execution?.status,
      buildNumber: progress.execution?.buildNumber,
      reports: lastExecution?.reports,
      reportLinks: lastExecution?.reportLinks
    });

    const finalStatuses = ['SUCCESS', 'FAILURE', 'STOPPED', 'ABORTED', 'CLEARED'];
    const status = progress.execution?.status;

    if (finalStatuses.includes(status)) {
      setRunningUi(false, status);
    }
  } catch (error) {
    console.error('Error reading live-progress.json', error);
  }
}

function setRunningUi(isRunning, status = null) {
  runButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  clearButton.disabled = isRunning;

  runButton.textContent = isRunning ? '...' : '▶';
  stopButton.textContent = '■';

  if (status) {
    jobStatus.className = `pill ${statusToPillClass(status)}`;
  }
}

function renderJobStatus(execution) {
  if (!execution) {
    jobStatus.textContent = 'JENKINS: IDLE';
    jobStatus.className = 'pill pill-muted';
    return;
  }

  const result = execution.result || 'IDLE';
  const buildNumber = execution.buildNumber ? ` #${execution.buildNumber}` : '';

  jobStatus.textContent = `JENKINS: ${result}${buildNumber}`;
  jobStatus.className = `pill ${statusToPillClass(result)}`;
}

function renderReportLinks(execution = {}) {
  if (!reportLinks || !reportSyncStatus) return;

  const result = String(execution.result || execution.status || '').toUpperCase();
  const reports = execution.reports || {};
  const links = execution.reportLinks || reports.reportLinks || {};
  const hasBuild = Boolean(execution.buildNumber);
  const isFinal = ['SUCCESS', 'FAILURE', 'STOPPED', 'ABORTED'].includes(result);

  reportSyncStatus.textContent = reports.syncedAt
    ? `SYNC ${formatDate(reports.syncedAt)}`
    : (hasBuild ? `BUILD #${execution.buildNumber}` : '--');

  if (!hasBuild) {
    reportLinks.innerHTML = '<div class="empty-state">Los enlaces se habilitan cuando Jenkins asigna un build.</div>';
    return;
  }

  const items = [
    { label: 'Build Jenkins', href: links.jenkinsBuild },
    { label: 'Live progress', href: links.liveProgress || '/reports/live-progress.json' },
    { label: 'Newman HTML', href: links.newmanHtml || '/reports/newman-report.html', disabled: !isFinal && !reports.newmanReport },
    { label: 'Newman JSON', href: links.newmanJson || '/reports/newman-result.json', disabled: !isFinal && !reports.newmanResult }
  ];

  reportLinks.innerHTML = items.map(item => {
    if (!item.href || item.disabled) {
      return `<span class="report-link disabled">${escapeHtml(item.label)}</span>`;
    }

    return `<a class="report-link" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`;
  }).join('');
}
function renderExecution(execution) {
  document.getElementById('metricCollection').textContent = execution.collection || '--';
  document.getElementById('metaStarted').textContent = formatDate(execution.startedAt);
  document.getElementById('metaFinished').textContent = formatDate(execution.finishedAt);
  document.getElementById('metaDuration').textContent = formatDuration(execution.durationMs);
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

function renderApis(apis) {
  const apiList = document.getElementById('apiList');
  const apiCounter = document.getElementById('apiCounter');

  apiCounter.textContent = String(apis.length);
  apiList.innerHTML = '';

  if (!apis.length) {
    apiList.innerHTML = '<div class="empty-state">Sin APIs ejecutadas todavía.</div>';
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
        <span>${api.statusCode || '--'}</span>
        <span>${api.responseTime || '--'} ms</span>
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

function clearDashboardView() {
  document.getElementById('apiList').innerHTML = '<div class="empty-state">Resultados limpiados.</div>';
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

refreshStatus();
refreshLiveProgress();
