# FASE 5 - Arquitectura de runs por modulo y runId

## Objetivo

Separar la nueva version del prototipo viejo y trabajar con un contrato API por modulo:

- Version vieja clonada: `/run/player`, `/status`, `/reports/live-progress.json`, Job Jenkins `player`, `jenkins/Jenkinsfile.player`.
- Version FASE 5: `/api/ply/runs`, Job Jenkins `PLY`, `jenkins/Jenkinsfile.ply`.

El nuevo `server.js` no mantiene rutas legacy.

## Regla de arquitectura

Todos los modulos usan la misma coleccion Postman y el mismo environment:

```text
POSTMAN_COLLECTION_FILE=collections/REGRESIVOS.postman_collection.json
POSTMAN_ENVIRONMENT_FILE=environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
```

La relacion correcta es:

```text
module -> Jenkins Job
flow -> Newman folder dentro de REGRESIVOS
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

## Modulos

`src/modules.js` declara:

- `ply`: operativo en esta fase.
- `usr`: declarado, no operativo.
- `cms`: declarado, no operativo.
- `gps`: declarado, no operativo.

Variables de entorno esperadas:

```env
PLY_JOB_NAME=PLY
USR_JOB_NAME=USR
CMS_JOB_NAME=CMS
GPS_JOB_NAME=GPS
```

## Endpoints nuevos

### Listar modulos

```http
GET /api/modules
```

### Listar flujos de un modulo

```http
GET /api/ply/flows
```

Cada flujo devuelve el `folderName` que se enviara a Newman.

### Crear una ejecucion

```http
POST /api/ply/runs
Content-Type: application/json
```

Payload ejemplo:

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

El backend resuelve internamente:

```text
flow=getmedia -> folderName=Getmedia
module=ply -> jobName=PLY
```

La respuesta es rapida: crea el run en memoria, dispara Jenkins y responde `202` con el `runId`.

### Consultar una ejecucion

```http
GET /api/ply/runs/{runId}
```

### Consultar estado/progreso resumido

```http
GET /api/ply/runs/{runId}/status
GET /api/ply/runs/{runId}/progress
```

### Consultar reportes

```http
GET /api/ply/runs/{runId}/reports
```

Devuelve links a los artifacts de Jenkins cuando ya existe `buildNumber`:

- `jenkinsBuild`
- `jenkinsLiveProgress`
- `jenkinsNewmanHtml`
- `jenkinsNewmanJson`

## Store temporal

`src/runStore.js` guarda las ejecuciones en memoria por modulo y por `runId`.

Cada run contiene:

- `id`
- `module`
- `collection`
- `flow`
- `newmanFolder`
- `status`
- `config`
- `executionSteps`
- `qaConsole`
- `summary`
- `apiExecutions`
- `reports`
- `startedAt`
- `finishedAt`

El store conserva por defecto las ultimas 50 ejecuciones por modulo:

```env
RUN_STORE_LIMIT_PER_MODULE=50
```

Al reiniciar el backend, el historial se pierde. Esto es intencional para esta fase y deja el store encapsulado para reemplazarlo por persistencia mas adelante.

## Jenkins PLY

El nuevo Job Jenkins debe llamarse `PLY` y configurarse como Pipeline script from SCM usando:

```text
jenkins/Jenkinsfile.ply
```

Parametros enviados por el backend a Jenkins:

- `module`
- `runId`
- `collectionFile`
- `environmentFile`
- `flow`
- `folderName`
- `environment`
- `platform`
- `serviceType`
- `device`
- `region`
- `endpointType`
- `userFlow`
- `dashboardBaseUrl`

Jenkins ejecuta Newman con:

```bash
newman run "collections/REGRESIVOS.postman_collection.json" \
  -e "environments/PRE-UAT-PROD-CLAROVIDEO.postman_environment.json" \
  --folder "Getmedia" \
  --reporters cli,htmlextra,json
```

Durante la ejecucion, Jenkins publica `reports/live-progress.json` al backend en:

```http
POST /api/ply/runs/{runId}/progress
```
