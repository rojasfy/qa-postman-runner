const crypto = require('crypto');

const DEFAULT_LIMIT_PER_MODULE = 50;
const FINAL_STATUSES = new Set(['SUCCESS', 'FAILURE', 'ABORTED', 'STOPPED', 'CLEARED', 'UNKNOWN']);

function createDefaultSummary() {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    currentApi: null
  };
}

class RunStore {
  constructor(options = {}) {
    this.limitPerModule = options.limitPerModule || DEFAULT_LIMIT_PER_MODULE;
    this.runsByModule = new Map();
  }

  create(input) {
    const now = input.startedAt || new Date().toISOString();
    const moduleId = String(input.module || '').toLowerCase();

    const run = {
      id: input.id || crypto.randomUUID(),
      module: moduleId,
      collection: input.collection || null,
      flow: input.flow || null,
      newmanFolder: input.newmanFolder || null,
      status: input.status || 'QUEUED',
      queueId: input.queueId || null,
      buildNumber: input.buildNumber || null,
      buildUrl: input.buildUrl || null,
      jobName: input.jobName || null,
      command: input.command || null,
      config: input.config || {},
      executionSteps: input.executionSteps || [],
      qaConsole: input.qaConsole || [],
      summary: input.summary || createDefaultSummary(),
      apiExecutions: input.apiExecutions || [],
      reports: input.reports || {},
      result: input.result || input.status || 'QUEUED',
      startedAt: now,
      finishedAt: input.finishedAt || null,
      updatedAt: now,
      lastError: input.lastError || null
    };

    const runs = this.runsByModule.get(moduleId) || [];
    runs.push(run);
    this.runsByModule.set(moduleId, runs);
    this.prune(moduleId);

    return this.get(moduleId, run.id);
  }

  list(moduleId) {
    const moduleKey = String(moduleId || '').toLowerCase();
    return [...(this.runsByModule.get(moduleKey) || [])]
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }

  get(moduleId, runId) {
    const moduleKey = String(moduleId || '').toLowerCase();
    return (this.runsByModule.get(moduleKey) || []).find(run => run.id === runId) || null;
  }

  update(moduleId, runId, updater) {
    const run = this.get(moduleId, runId);
    if (!run) return null;

    const patch = typeof updater === 'function' ? updater(run) : updater;
    if (patch && typeof patch === 'object') {
      Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    }

    this.prune(moduleId);
    return run;
  }

  findLatest(moduleId) {
    return this.list(moduleId)[0] || null;
  }

  findLatestActive(moduleId) {
    return this.list(moduleId).find(run => !FINAL_STATUSES.has(String(run.status || '').toUpperCase())) || null;
  }

  findByBuildNumber(moduleId, buildNumber) {
    const number = String(buildNumber || '');
    if (!number) return null;

    return this.list(moduleId).find(run => String(run.buildNumber || '') === number) || null;
  }

  clearModule(moduleId) {
    this.runsByModule.set(String(moduleId || '').toLowerCase(), []);
  }

  prune(moduleId) {
    const moduleKey = String(moduleId || '').toLowerCase();
    const runs = this.runsByModule.get(moduleKey) || [];

    if (runs.length <= this.limitPerModule) return;

    const sorted = [...runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    this.runsByModule.set(moduleKey, sorted.slice(0, this.limitPerModule));
  }
}

module.exports = {
  RunStore,
  FINAL_STATUSES,
  createDefaultSummary
};
