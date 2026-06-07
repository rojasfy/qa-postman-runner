# Optimizacion de tiempos - FASE 4

## Problema observado

La ejecucion PLAYER quedo funcional en FASE 3, pero se detecto lentitud por una combinacion de factores:

```text
node_modules dentro de volumen compartido Windows <-> Docker
workspace ejecutado sobre carpeta montada
instalacion de dependencias en cada build
escrituras frecuentes sobre reports/live-progress.json
lectura frecuente del dashboard sobre live-progress.json
generacion de reportes Newman JSON y HTML
archivado de artefactos al final del pipeline
```

## Prioridad 1 - Medir antes de cambiar

Registrar tiempos por build:

```text
checkout SCM
validacion de parametros
preparacion de reports/
validacion/instalacion de dependencias
ejecucion Newman
generacion newman-result.json
generacion newman-report.html
archivado de artefactos
```

Jenkins ya muestra duracion por stage. Para mas detalle, envolver comandos criticos con `time`.

## Prioridad 2 - No reinstalar dependencias en cada build

Decision FASE 4:

```text
El Jenkinsfile valida si node_modules/newman existe y si require('newman') funciona.
Solo instala dependencias si Newman no esta disponible o esta corrupto.
La cache npm se guarda en /var/jenkins_home/npm-cache/player.
```

Beneficio esperado:

```text
Evita npm ci completo en cada ejecucion.
Reduce I/O sobre Windows <-> Docker.
Reduce fallos por permisos cruzados.
```

## Prioridad 3 - Evitar node_modules en volumen Windows

La mayor penalizacion suele venir de miles de archivos chicos en `node_modules` viviendo en una carpeta montada desde Windows.

Opciones:

```text
Opcion A:
Checkout SCM dentro de /var/jenkins_home/workspace/PLAYER y dependencias alli.

Opcion B:
Construir una imagen Docker Jenkins/Node con dependencias base preinstaladas.

Opcion C:
Usar cache persistente Linux dentro del contenedor y no en C:\.
```

Recomendacion:

```text
Usar workspace interno de Jenkins para codigo y node_modules.
Mantener solo reports/ sincronizado con el dashboard.
```

## Prioridad 4 - Reducir escrituras de live-progress.json

Actualmente el runner escribe `live-progress.json` en:

```text
start
cada request /services
cada assertion
done
```

Esto puede ser costoso cuando el archivo crece, porque cada escritura reserializa todo el JSON.

Opciones pendientes:

```text
Escribir solo cada N eventos.
Escribir con debounce cada 500-1000 ms.
Separar summary liviano de detalle pesado.
Guardar response body solo si falla la API.
Truncar response bodies grandes.
Mantener live-progress.json liviano y dejar detalle completo en newman-result.json.
```

## Prioridad 5 - Ajustar frecuencia del dashboard

El dashboard consulta cada 1500 ms:

```text
GET /status
GET /reports/live-progress.json
```

Si `live-progress.json` crece mucho, cada refresh mueve y parsea demasiado JSON.

Opciones:

```text
Subir refresh a 2500-5000 ms para corridas grandes.
Pedir primero un endpoint liviano /status.
Descargar live-progress.json completo solo si cambio updatedAt o version.
Agregar ETag/Last-Modified.
Servir un live-summary.json separado.
```

## Prioridad 6 - Reportes Newman

`newman-result.json` y `newman-report.html` son utiles, pero pueden ser pesados.

Opciones:

```text
Modo rapido: reporters ['cli'] y live-progress.json.
Modo completo: reporters ['cli', 'json', 'htmlextra'].
Generar HTML solo al final y bajo demanda.
Archivar HTML solo en builds fallidos o nightly.
```

Recomendacion pendiente:

```text
Agregar un parametro Jenkins REPORT_MODE=live|full.
live: no genera htmlextra.
full: genera JSON + HTML.
```

## Orden recomendado

1. Medir duracion por stage con el pipeline SCM.
2. Confirmar si la mayor demora esta en dependencias o en Newman.
3. Mover checkout y node_modules al workspace interno Jenkins.
4. Mantener sincronizado solo `reports/` para el dashboard.
5. Reducir escrituras de `live-progress.json`.
6. Separar modo live de modo full-report.
7. Evaluar imagen Docker con dependencias preinstaladas.

## Decision FASE 4

No se cambia todavia el contrato funcional de `live-progress.json`.

Las optimizaciones quedan documentadas y listas para implementarse de forma incremental sin romper el flujo validado:

```text
HTML -> server.js -> Jenkins -> runners/player.js -> Newman -> reports/live-progress.json -> HTML
```
