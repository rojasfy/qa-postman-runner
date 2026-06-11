# QA Postman Runner

Dashboard y API local para ejecutar regresiones Postman con Newman desde un unico job Jenkins parametrizado. La arquitectura activa es modular: el backend recibe el modulo, resuelve el flujo, dispara Jenkins y conserva el estado temporal del run en memoria.

## Estructura vigente

```text
qa-postman-runner/
|-- collections/
|   `-- REGRESIVOS.postman_collection.json
|-- docs/
|   `-- flujo-ejecucion-modular.md
|-- environments/
|   `-- PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
|-- jenkins/
|   `-- Jenkinsfile.modular
|-- public/
|-- reports/
|   `-- .gitkeep
|-- runners/
|   `-- modular.js
|-- src/
|   |-- modules.js
|   |-- progressMapper.js
|   `-- runStore.js
|-- .env.example
|-- .gitignore
|-- package.json
|-- package-lock.json
|-- README.md
`-- server.js
```

`legacy/` esta ignorado por Git y no forma parte de la arquitectura activa.

## Modulos activos

Los modulos vigentes estan definidos en `src/modules.js` y comparten la coleccion y el environment configurados por variables de entorno.

```text
ply:
  - Getmedia
  - Assets
  - Tracking - Bookmark

usr:
  - Perfiles
  - Favorited
  - ControlPin
  - Reminder
```

## Configuracion

Instalar dependencias:

```bash
npm install
```

Crear `.env` desde `.env.example` y completar credenciales Jenkins:

```bash
cp .env.example .env
```

Variables principales:

```env
PORT=3000
JENKINS_BASE_URL=http://localhost:8080
JENKINS_USER=admin
JENKINS_API_TOKEN=REEMPLAZAR_CON_API_TOKEN_REAL
JENKINS_DASHBOARD_BASE_URL=http://host.docker.internal:3000
REGRESIVOS_JOB_NAME=REGRESIVOS-MODULAR
POSTMAN_COLLECTION_FILE=collections/REGRESIVOS.postman_collection.json
POSTMAN_ENVIRONMENT_FILE=environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
RUN_STORE_LIMIT_PER_MODULE=50
```

Levantar dashboard y API:

```bash
npm run server
```

## Ejecutar modular.js localmente

El runner modular ejecuta Newman contra el folder indicado por `--folderName` y genera reportes en `reports/`.

Ejemplo PLY:

```bash
npm run modular -- \
  --module ply \
  --runId local-ply-001 \
  --collectionFile collections/REGRESIVOS.postman_collection.json \
  --environmentFile environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json \
  --flow getmedia \
  --folderName Getmedia \
  --environment uat-berc \
  --platform aws \
  --serviceType ott \
  --device web \
  --region brasil \
  --endpointType origin
```

Ejemplo USR:

```bash
npm run modular -- \
  --module usr \
  --runId local-usr-001 \
  --collectionFile collections/REGRESIVOS.postman_collection.json \
  --environmentFile environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json \
  --flow perfiles \
  --folderName Perfiles \
  --environment uat-berc \
  --platform aws \
  --serviceType ott \
  --device web \
  --region brasil \
  --endpointType origin
```

## Parametros dinamicos soportados

El backend, Jenkins y `runners/modular.js` usan estos parametros:

```text
module
runId
collectionFile
environmentFile
flow
folderName
environment
platform
serviceType
device
region
endpointType
userFlow
dashboardBaseUrl
liveProgressMode
liveProgressTimeoutMs
```

`folderName` es el nombre exacto del folder Newman dentro de la coleccion. `flow` es el identificador usado por el dashboard/API para resolver ese folder.

## Reportes Newman

Cada ejecucion genera artifacts en `reports/`:

```text
reports/live-progress.json
reports/newman-result.json
reports/newman-report.html
```

`live-progress.json` alimenta el progreso del dashboard. Durante la ejecucion Jenkins publica un payload liviano en modo `filtered`; al finalizar, el backend puede cargar el detalle completo desde el artifact final.

## Uso desde Jenkins

Crear un unico job Pipeline llamado `REGRESIVOS-MODULAR`:

```text
Definition: Pipeline script from SCM
SCM: Git
Repository URL: <URL_DEL_REPOSITORIO>
Credentials: <credencial Git si aplica>
Branch Specifier: */main
Script Path: jenkins/Jenkinsfile.modular
Lightweight checkout: enabled
```

El job recibe parametros desde el backend y ejecuta:

```bash
node runners/modular.js
```

Jenkins publica progreso al backend con:

```http
POST /api/:module/runs/:runId/progress
```

Para Jenkins en Docker sobre Windows, el valor recomendado es:

```text
dashboardBaseUrl=http://host.docker.internal:3000
```

Validar conectividad desde el agente Jenkins:

```bash
curl -i http://host.docker.internal:3000/api/modules
```

## Endpoints principales

```http
GET  /api/modules
GET  /api/:module/flows
GET  /api/:module/runs
POST /api/:module/runs
GET  /api/:module/runs/:runId
GET  /api/:module/runs/:runId/status
GET  /api/:module/runs/:runId/progress
POST /api/:module/runs/:runId/progress
GET  /api/:module/runs/:runId/reports
POST /api/:module/runs/:runId/stop
```
