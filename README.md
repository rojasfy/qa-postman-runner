# QA Postman Runner

Plataforma local/CI para ejecutar regresiones API de Postman con Newman, Jenkins, Docker y un dashboard HTML con progreso en vivo.

## Estado

FASE 3 quedo cerrada funcionalmente para el modulo PLAYER.

Flujo validado:

```text
Dashboard HTML
  -> server.js
  -> Jenkins REST API
  -> Job Jenkins PLAYER
  -> runners/player.js
  -> Newman
  -> reports/live-progress.json
  -> Dashboard HTML
```

FASE 4 prepara el proyecto para Git, Jenkins desde SCM y documenta optimizaciones de tiempo. No incluye FASE 5.

## Estructura versionable

```text
qa-postman-runner/
|-- collections/
|   `-- REGRESIVOS.postman_collection.json
|-- environments/
|   `-- PRE-UAT-PROD-CLAROVIDEO.postman_environment.json
|-- jenkins/
|   `-- Jenkinsfile.player
|-- public/
|   |-- app.js
|   |-- live-viewer.html
|   `-- styles.css
|-- reports/
|   `-- .gitkeep
|-- runners/
|   `-- player.js
|-- docs/
|   |-- fase-4.md
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

## Configuracion local

Instalar dependencias:

```bash
npm install
```

Crear `.env` desde `.env.example` y completar las credenciales Jenkins:

```bash
cp .env.example .env
```

Levantar el dashboard:

```bash
npm run server
```

Abrir:

```text
http://localhost:3000
```

## Jenkins: Pipeline script from SCM

Crear o reconfigurar el job PLAYER como Pipeline:

```text
Definition: Pipeline script from SCM
SCM: Git
Repository URL: <URL_DEL_REPOSITORIO>
Credentials: <credencial Git si aplica>
Branch Specifier: */main
Script Path: jenkins/Jenkinsfile.player
Lightweight checkout: enabled
```

El pipeline versionado vive en:

```text
jenkins/Jenkinsfile.player
```

El pipeline ejecuta el runner desde el workspace SCM del job y genera:

```text
reports/live-progress.json
reports/newman-result.json
reports/newman-report.html
```

Para que el dashboard vea el progreso, Jenkins y `server.js` deben compartir o sincronizar el mismo directorio `reports/`.

## Git inicial

Desde la raiz del proyecto:

```bash
git init
git add collections environments jenkins public runners reports/.gitkeep server.js package.json package-lock.json .env.example .gitignore README.md docs
git commit -m "chore: prepare qa postman runner phase 4"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO>
git push -u origin main
```

Antes de hacer commit, validar ignorados:

```bash
git check-ignore -v .env node_modules reports/live-progress.json reports/newman-result.json reports/newman-report.html
```

## Documentacion

```text
docs/fase-4.md
docs/optimizacion-tiempos.md
```
