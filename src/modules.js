const path = require('path');

const SHARED_COLLECTION_FILE = process.env.POSTMAN_COLLECTION_FILE || 'collections/REGRESIVOS.postman_collection.json';
const SHARED_ENVIRONMENT_FILE = process.env.POSTMAN_ENVIRONMENT_FILE || 'environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json';

function env(name, fallback) {
  const value = process.env[name];
  return value && String(value).trim() ? value : fallback;
}

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
    jobName: env('PLY_JOB_NAME', 'PLY'),
    collectionFile: SHARED_COLLECTION_FILE,
    environmentFile: SHARED_ENVIRONMENT_FILE,
    legacyCollectionParam: 'PLAYER',
    flows: [
      { id: 'getmedia', label: 'Getmedia', folderName: 'Getmedia' },
      { id: 'assets', label: 'Assets', folderName: 'Assets' },
      { id: 'tracking-bookmark', label: 'Tracking - Bookmark', folderName: 'Tracking - Bookmark' }
    ]
  },

  usr: {
    id: 'usr',
    label: 'USR',
    enabled: false,
    jobName: env('USR_JOB_NAME', 'USR'),
    collectionFile: SHARED_COLLECTION_FILE,
    environmentFile: SHARED_ENVIRONMENT_FILE,
    flows: []
  },

  cms: {
    id: 'cms',
    label: 'CMS',
    enabled: false,
    jobName: env('CMS_JOB_NAME', 'CMS'),
    collectionFile: SHARED_COLLECTION_FILE,
    environmentFile: SHARED_ENVIRONMENT_FILE,
    flows: []
  },

  gps: {
    id: 'gps',
    label: 'GPS',
    enabled: false,
    jobName: env('GPS_JOB_NAME', 'GPS'),
    collectionFile: SHARED_COLLECTION_FILE,
    environmentFile: SHARED_ENVIRONMENT_FILE,
    flows: []
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

