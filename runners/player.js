const fs = require('fs');
const path = require('path');
const newman = require('newman');

const ROOT_DIR = path.resolve(__dirname, '..');

const COLLECTION_PATH = path.join(
    ROOT_DIR,
    'collections',
    'REGRESIVOS.postman_collection.json'
);

const ENVIRONMENT_PATH = path.join(
    ROOT_DIR,
    'environments',
    'PRE-UAT-PROD-CLAROVIDEO.postman_environment.json'
);

const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

const LIVE_PROGRESS_PATH = path.join(REPORTS_DIR, 'live-progress.json');
const NEWMAN_JSON_REPORT_PATH = path.join(REPORTS_DIR, 'newman-result.json');
const NEWMAN_HTML_REPORT_PATH = path.join(REPORTS_DIR, 'newman-report.html');

function ensureReportsDir() {
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};

    for (let i = 0; i < args.length; i++) {
        const current = args[i];

        if (current.startsWith('--')) {
            const key = current.replace('--', '');
            const value = args[i + 1];

            if (value && !value.startsWith('--')) {
                params[key] = value;
                i++;
            } else {
                params[key] = true;
            }
        }
    }

    return {
        environment: params.environment || 'uat',
        platform: params.platform || 'aws',
        serviceType: params.serviceType || 'ott',
        device: params.device || 'web',
        region: params.region || 'mexico',
        endpointType: params.endpointType || 'origin',
        folder: params.folder || null,
        userFlow: null
    };
}

function validateRequiredFiles() {
    if (!fs.existsSync(COLLECTION_PATH)) {
        throw new Error(`No existe la colección: ${COLLECTION_PATH}`);
    }

    if (!fs.existsSync(ENVIRONMENT_PATH)) {
        throw new Error(`No existe el environment: ${ENVIRONMENT_PATH}`);
    }
}

function validateRequiredParameters(parameters) {
    if (!parameters.folder) {
        throw new Error(
            'Debes indicar un folder para ejecutar. Ejemplo: node runners/player.js --folder Getmedia'
        );
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

function headersToObject(headers) {
    const result = {};

    if (!headers) {
        return result;
    }

    try {
        if (typeof headers.each === 'function') {
            headers.each((header) => {
                result[header.key] = header.value;
            });

            return result;
        }

        if (Array.isArray(headers)) {
            headers.forEach((header) => {
                result[header.key] = header.value;
            });

            return result;
        }
    } catch (error) {
        return result;
    }

    return result;
}

function getRequestBody(request) {
    if (!request || !request.body) {
        return null;
    }

    try {
        if (request.body.raw) {
            return safeJsonParse(request.body.raw);
        }

        if (request.body.urlencoded) {
            const body = {};

            request.body.urlencoded.each((item) => {
                body[item.key] = item.value;
            });

            return body;
        }

        if (request.body.formdata) {
            const body = {};

            request.body.formdata.each((item) => {
                body[item.key] = item.value;
            });

            return body;
        }

        return request.body.toString();
    } catch (error) {
        return null;
    }
}

function getResponseBody(response) {
    if (!response || !response.stream) {
        return null;
    }

    try {
        const rawBody = response.stream.toString('utf8');
        return safeJsonParse(rawBody);
    } catch (error) {
        return null;
    }
}

function sanitizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();
}

function getItemId(item) {
    if (!item) {
        return null;
    }

    if (item.id) {
        return item.id;
    }

    if (item.name) {
        return sanitizeText(item.name);
    }

    return null;
}

function createInitialProgress(parameters) {
    return {
        execution: {
            status: 'RUNNING',
            collection: 'PLAYER',
            buildNumber: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            durationMs: null
        },
        parameters,
        summary: {
            total: 0,
            passed: 0,
            failed: 0,
            currentApi: null
        },
        apis: []
    };
}

function updateSummary(progress) {
    progress.summary.total = progress.apis.length;
    progress.summary.passed = progress.apis.filter(api => api.status === 'PASSED').length;
    progress.summary.failed = progress.apis.filter(api => api.status === 'FAILED').length;

    if (progress.apis.length > 0) {
        progress.summary.currentApi = progress.apis[progress.apis.length - 1].name;
    } else {
        progress.summary.currentApi = null;
    }
}

function getLastApi(progress) {
    if (!progress.apis || progress.apis.length === 0) {
        return null;
    }

    return progress.apis[progress.apis.length - 1];
}

function buildEnvVars(parameters) {
    return [
        {
            key: 'environment',
            value: parameters.environment
        },
        {
            key: 'platform',
            value: parameters.platform
        },
        {
            key: 'serviceType',
            value: parameters.serviceType
        },
        {
            key: 'device',
            value: parameters.device
        },
        {
            key: 'region',
            value: parameters.region
        },
        {
            key: 'endpointType',
            value: parameters.endpointType
        }
    ];
}

function finishExecution(progress, startedAtMs, status) {
    progress.execution.finishedAt = new Date().toISOString();
    progress.execution.durationMs = Date.now() - startedAtMs;
    progress.execution.status = status;

    updateSummary(progress);
    writeJson(LIVE_PROGRESS_PATH, progress);
}

async function runPlayer() {
    ensureReportsDir();
    validateRequiredFiles();

    const parameters = parseArgs();

    validateRequiredParameters(parameters);

    const startedAtMs = Date.now();
    const progress = createInitialProgress(parameters);

    writeJson(LIVE_PROGRESS_PATH, progress);

    console.log('========================================');
    console.log(' QA POSTMAN RUNNER ');
    console.log('========================================');
    console.log('Collection:', COLLECTION_PATH);
    console.log('Environment:', ENVIRONMENT_PATH);
    console.log('Reports dir:', REPORTS_DIR);
    console.log('Live progress:', LIVE_PROGRESS_PATH);
    console.log('Parameters:', parameters);
    console.log('========================================');

    const newmanOptions = {
        collection: COLLECTION_PATH,
        environment: ENVIRONMENT_PATH,
        folder: parameters.folder,
        envVar: buildEnvVars(parameters),
        reporters: ['cli', 'json', 'htmlextra'],
        reporter: {
            json: {
                export: NEWMAN_JSON_REPORT_PATH
            },
            htmlextra: {
                export: NEWMAN_HTML_REPORT_PATH
            }
        }
    };

    newman.run(newmanOptions)
        .on('start', function () {
            console.log('[NEWMAN] Ejecución iniciada');
            progress.execution.status = 'RUNNING';
            writeJson(LIVE_PROGRESS_PATH, progress);
        })

        .on('request', function (error, args) {
            const request = args.request;
            const response = args.response;
            const item = args.item;

            if (!request || !request.url) {
                return;
            }

            const url = request.url.toString();

            if (!url.includes('/services')) {
                return;
            }

            const statusCode = response ? response.code : null;
            const statusText = response ? response.status : null;
            const responseTime = response ? response.responseTime : null;

            const apiStatus = error || statusCode >= 400 ? 'FAILED' : 'PASSED';

            const api = {
                id: progress.apis.length + 1,
                itemId: getItemId(item),
                name: item && item.name ? sanitizeText(item.name) : `${request.method} ${url}`,
                method: request.method,
                url,
                status: apiStatus,
                statusCode,
                statusText,
                responseTime,
                executedAt: new Date().toISOString(),
                request: {
                    headers: headersToObject(request.headers),
                    body: getRequestBody(request)
                },
                response: {
                    headers: response ? headersToObject(response.headers) : {},
                    body: getResponseBody(response)
                },
                assertions: []
            };

            progress.apis.push(api);
            updateSummary(progress);
            writeJson(LIVE_PROGRESS_PATH, progress);

            console.log(
                `[LIVE] ${api.method} ${api.name} | ${api.statusCode} | ${api.responseTime}ms | ${api.status}`
            );
        })

        .on('assertion', function (error, args) {
            const lastApi = getLastApi(progress);

            if (!lastApi) {
                return;
            }

            const assertionName = sanitizeText(args.assertion);

            const assertion = {
                name: assertionName,
                status: error ? 'FAILED' : 'PASSED',
                errorMessage: error ? error.message : null,
                executedAt: new Date().toISOString()
            };

            lastApi.assertions.push(assertion);

            if (error) {
                lastApi.status = 'FAILED';
            }

            updateSummary(progress);
            writeJson(LIVE_PROGRESS_PATH, progress);

            console.log(
                `[ASSERTION] ${lastApi.name} | ${assertion.name} | ${assertion.status}`
            );
        })

        .on('done', function (error, summary) {
            const failures = summary && summary.run && summary.run.failures
                ? summary.run.failures.length
                : 0;

            if (error || failures > 0) {
                finishExecution(progress, startedAtMs, 'FAILURE');
            } else {
                finishExecution(progress, startedAtMs, 'SUCCESS');
            }

            if (error) {
                console.error('[NEWMAN] Error en ejecución:', error);
                process.exit(1);
            }

            if (failures > 0) {
                console.error('[NEWMAN] Ejecución finalizada con fallos');
                console.error(`Total failures: ${failures}`);
                process.exit(1);
            }

            console.log('[NEWMAN] Ejecución finalizada correctamente');
            console.log('Reporte JSON:', NEWMAN_JSON_REPORT_PATH);
            console.log('Reporte HTML:', NEWMAN_HTML_REPORT_PATH);
            console.log('Live progress:', LIVE_PROGRESS_PATH);

            process.exit(0);
        });
}

runPlayer().catch((error) => {
    console.error('[PLAYER] Error:', error.message);
    process.exit(1);
});