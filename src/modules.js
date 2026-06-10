const path = require('path');

const SHARED_COLLECTION_FILE = process.env.POSTMAN_COLLECTION_FILE || 'collections/REGRESIVOS.postman_collection.json';
const SHARED_ENVIRONMENT_FILE = process.env.POSTMAN_ENVIRONMENT_FILE || 'environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json';

function env(name, fallback) {
  const value = process.env[name];
  return value && String(value).trim() ? value : fallback;
}

const REGRESIVOS_JOB_NAME = env('REGRESIVOS_JOB_NAME', 'REGRESIVOS-MODULAR');

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const moduleConfig = {
  ply: {
    id: 'ply',
    label: 'PLY',
    enabled: true,
    jobName: REGRESIVOS_JOB_NAME,
    collectionFile: SHARED_COLLECTION_FILE,
    environmentFile: SHARED_ENVIRONMENT_FILE,
    flows: [
      { id: 'getmedia', label: 'Getmedia', folderName: 'Getmedia' },
      { id: 'assets', label: 'Assets', folderName: 'Assets' },
      { id: 'tracking-bookmark', label: 'Tracking - Bookmark', folderName: 'Tracking - Boolmark' }
    ]
  },

  usr: {
    id: 'usr',
    label: 'USR',
    enabled: true,
    jobName: REGRESIVOS_JOB_NAME,
    collectionFile: SHARED_COLLECTION_FILE,
    environmentFile: SHARED_ENVIRONMENT_FILE,
    flows: [
      { id: 'perfiles', label: 'Perfiles', folderName: 'Perfiles' },
      { id: 'favorited', label: 'Favorited', folderName: 'Favorited' },
      { id: 'controlpin', label: 'ControlPin', folderName: 'ControlPin' },
      { id: 'reminder', label: 'Reminder', folderName: 'Reminder' }
    ]
  }
};

function getModuleConfig(moduleId) {
  return moduleConfig[String(moduleId || '').toLowerCase()] || null;
}

function listModules() {
  return Object.values(moduleConfig).map(module => ({
    id: module.id,
    label: module.label,
    enabled: module.enabled,
    jobName: module.jobName,
    collectionFile: module.collectionFile,
    environmentFile: module.environmentFile,
    flowsCount: module.flows.length
  }));
}

function listFlows(moduleId) {
  const module = getModuleConfig(moduleId);
  return module ? module.flows.map(flow => ({ ...flow })) : [];
}

function resolveFlow(module, requestedFlow, fallbackFolder) {
  const flowKey = String(requestedFlow || '').trim().toLowerCase();
  const folderKey = String(fallbackFolder || '').trim().toLowerCase();

  if (flowKey) {
    const byId = module.flows.find(flow => flow.id.toLowerCase() === flowKey);
    if (byId) return { ...byId };

    const byLabel = module.flows.find(flow => flow.label.toLowerCase() === flowKey);
    if (byLabel) return { ...byLabel };

    const byFolder = module.flows.find(flow => flow.folderName.toLowerCase() === flowKey);
    if (byFolder) return { ...byFolder };
  }

  if (folderKey) {
    const byFolder = module.flows.find(flow => flow.folderName.toLowerCase() === folderKey);
    if (byFolder) return { ...byFolder };

    return {
      id: slug(fallbackFolder),
      label: fallbackFolder,
      folderName: fallbackFolder,
      fallback: true
    };
  }

  return null;
}

function getCollectionLabel(collectionFile) {
  const fileName = path.basename(collectionFile || SHARED_COLLECTION_FILE);
  return fileName.replace(/\.postman_collection\.json$/i, '').replace(/\.json$/i, '');
}

module.exports = {
  getModuleConfig,
  listModules,
  listFlows,
  resolveFlow,
  getCollectionLabel,
  SHARED_COLLECTION_FILE,
  SHARED_ENVIRONMENT_FILE
};

