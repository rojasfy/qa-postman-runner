# FASE 6 - Dashboard modular sobre rutas nuevas

## Objetivo

Mantener el esqueleto visual del dashboard existente, pero reemplazar la logica antigua por las rutas modulares de FASE 5.

La version vieja queda como respaldo independiente:

```text
Version vieja:
  /run/player
  /status
  /reports/live-progress.json
  Jenkinsfile.player

Version nueva:
  /api/ply/runs
  /api/ply/runs/:runId/status
  /api/ply/runs/:runId/progress
  /api/ply/runs/:runId/reports
  Jenkinsfile.ply
```

## Cambios realizados

- Se conserva el diseno visual general del dashboard.
- Se agrega selector de modulo.
- Se agrega selector de flujo.
- Al cargar el dashboard se consulta:

```http
GET /api/modules
GET /api/ply/flows
```

- Al ejecutar se envia:

```http
POST /api/ply/runs
```

Payload ejemplo:

```json
{
  "flow": "getmedia",
  "environment": "uat-berc",
  "platform": "aws",
  "serviceType": "ott",
  "device": "web",
  "region": "mexico",
  "endpointType": "origin"
}
```

- El dashboard guarda el `id` devuelto por `/api/ply/runs`.
- El polling consulta el run usando ese `runId`:

```http
GET /api/ply/runs/:runId/status
GET /api/ply/runs/:runId/progress
GET /api/ply/runs/:runId/reports
```

## Archivos principales

```text
public/live-viewer.html
public/app.js
public/styles.css
server.js
```

`server.js` vuelve a servir el HTML estatico, pero no restaura rutas legacy de ejecucion.

## Estado

PLY queda conectado de punta a punta:

```text
Dashboard HTML
  -> /api/ply/flows
  -> /api/ply/runs
  -> runId
  -> Jenkins Job PLY
  -> Jenkinsfile.ply
  -> Newman
  -> /api/ply/runs/:runId/progress
  -> dashboard modular
```


## Regla de renderizado visible

El dashboard modular conserva el criterio de la version legacy: solo se muestran como APIs visibles las requests cuya URL o path pertenezca a `/services/`.

```text
Si la request pertenece a /services/:
  se muestra en el dashboard

Si la request no pertenece a /services/:
  no se muestra como API ejecutada
```

Esto evita renderizar requests tecnicos o auxiliares usados durante la ejecucion, por ejemplo Elasticsearch, preparaciones, configuraciones, consultas internas o validaciones que no correspondan a servicios.

La regla se aplica en tres capas:

- `runners/ply.js`: no agrega al `live-progress.json` requests fuera de `/services/`.
- `src/progressMapper.js`: filtra cualquier progreso recibido antes de guardar `apiExecutions`.
- `public/app.js`: filtra nuevamente antes de renderizar en pantalla.

Esta misma regla debe mantenerse cuando se activen `usr`, `cms` y `gps`.
## Pendiente para fases siguientes

- Implementar stop/cancel modular por runId si se requiere desde UI.
- Activar modulos `usr`, `cms` y `gps` con sus flujos reales.
- Adaptar esta logica al HTML real de la empresa.
