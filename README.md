# QA Postman Runner

Dashboard/API local para ejecutar regresiones API de Postman con Jenkins y Newman, usando un modelo modular de runs por `runId`.

## Estado actual

La FASE 6 conecta el dashboard visual actual con la API modular creada en FASE 5.

```text
Version vieja clonada:
  rutas: /run/player, /status, /reports/live-progress.json
  Jenkins Job: player
  Jenkinsfile: jenkins/Jenkinsfile.player

Version FASE 6:
  rutas: /api/ply/runs, /api/ply/runs/:runId/status, /api/ply/runs/:runId/reports
  Jenkins Job: PLY
  Jenkinsfile: jenkins/Jenkinsfile.ply
```

El nuevo `server.js` no conserva rutas legacy.

## Arquitectura

Todos los modulos usan una unica coleccion Postman y un unico environment:

```text
collections/REGRESIVOS.postman_collection.json
environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
```

La relacion correcta es:

```text
Modulo seleccionado -> Job Jenkins
Flujo seleccionado -> folder Newman dentro de REGRESIVOS
```

Ejemplo PLY:

```text
module = ply
jobName = PLY
flow = getmedia
folderName = Getmedia
collectionFile = collections/REGRESIVOS.postman_collection.json
environmentFile = environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
```

No se debe asumir que `moduleName`, `jobName`, `collectionName` y `folderName` son iguales.

## Estructura versionable

```text
qa-postman-runner/
|-- collections/
|   `-- REGRESIVOS.postman_collection.json
|-- environments/
|   `-- PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
|-- jenkins/
|   |-- Jenkinsfile.player
|   `-- Jenkinsfile.ply
|-- public/
|-- reports/
|   `-- .gitkeep
|-- runners/
|   |-- player.js
|   `-- ply.js
|-- src/
|   |-- modules.js
|   |-- progressMapper.js
|   `-- runStore.js
|-- docs/
|   |-- fase-4.md
|   |-- fase-5.md
|   |-- fase-6.md
|   `-- optimizacion-tiempos.md
|-- .env.example
|-- .gitignore
|-- package.json
|-- package-lock.json
|-- README.md
`-- server.js
```

No se versionan:

```text
.env
node_modules/
reports/*.json
reports/*.html
```

## Configuracion

Instalar dependencias:

```bash
npm install
```

Crear `.env` desde `.env.example` y completar las credenciales Jenkins:

```bash
cp .env.example .env
```

Variables principales:

```env
JENKINS_BASE_URL=http://localhost:8080
JENKINS_USER=admin
JENKINS_API_TOKEN=REEMPLAZAR_CON_API_TOKEN_REAL
JENKINS_DASHBOARD_BASE_URL=http://<IP_DE_TU_HOST>:3000

PLY_JOB_NAME=PLY
POSTMAN_COLLECTION_FILE=collections/REGRESIVOS.postman_collection.json
POSTMAN_ENVIRONMENT_FILE=environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
RUN_STORE_LIMIT_PER_MODULE=50
```

Levantar el dashboard/API:

```bash
npm run server
```

## Endpoints FASE 6

```http
GET  /api/modules
GET  /api/ply/flows
GET  /api/ply/runs
POST /api/ply/runs
GET  /api/ply/runs/:runId
GET  /api/ply/runs/:runId/status
GET  /api/ply/runs/:runId/progress
POST /api/ply/runs/:runId/progress
GET  /api/ply/runs/:runId/reports
```

Payload ejemplo para crear run:

```json
{
  "flow": "getmedia",
  "environment": "preuat",
  "platform": "aws",
  "region": "mexico",
  "device": "web",
  "endpointType": "origin"
}
```

## Jenkins PLY

Crear un nuevo Job Jenkins llamado `PLY` como Pipeline script from SCM:

```text
Definition: Pipeline script from SCM
SCM: Git
Repository URL: <URL_DEL_REPOSITORIO>
Credentials: <credencial Git si aplica>
Branch Specifier: */main
Script Path: jenkins/Jenkinsfile.ply
Lightweight checkout: enabled
```

Durante la ejecucion, Jenkins publica progreso al backend:

```http
POST /api/ply/runs/{runId}/progress
```

Los artifacts del Job son:

```text
reports/live-progress.json
reports/newman-result.json
reports/newman-report.html
```

## Documentacion

```text
docs/fase-4.md
docs/fase-5.md
docs/optimizacion-tiempos.md
```

