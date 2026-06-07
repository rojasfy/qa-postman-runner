# FASE 4 - Versionado Git y Jenkins desde SCM

## Objetivo

Dejar `qa-postman-runner` listo para trabajar desde Git y para que Jenkins ejecute el pipeline versionado en:

```text
jenkins/Jenkinsfile.player
```

Esta fase no avanza a FASE 5.

## Alcance

1. Preparar `.gitignore`.
2. Mantener fuera del repo credenciales, dependencias instaladas y reportes de ejecucion.
3. Crear README base del proyecto.
4. Definir estructura versionable.
5. Inicializar Git local.
6. Crear commit inicial.
7. Subir el repositorio a GitHub/GitLab/Bitbucket.
8. Configurar Jenkins como `Pipeline script from SCM`.
9. Usar `jenkins/Jenkinsfile.player` como `Script Path`.
10. Validar ejecucion directa desde Jenkins.
11. Validar ejecucion desde el dashboard HTML despues de la migracion a SCM.
12. Documentar optimizaciones de tiempo pendientes.

## Estado inicial detectado

El proyecto funcional esta en:

```text
C:\Users\rojas\Desktop\GlobalHitss\qa-postman-runner
```

La carpeta tenia la estructura de FASE 3, pero todavia no estaba inicializada como repositorio Git.

## Archivos que deben versionarse

```text
collections/
environments/
jenkins/
public/
runners/
reports/.gitkeep
server.js
package.json
package-lock.json
.env.example
.gitignore
README.md
docs/
```

## Archivos que no deben versionarse

```text
.env
.env.local
node_modules/
reports/live-progress.json
reports/newman-result.json
reports/newman-report.html
npm-debug.log*
.npm-cache/
```

Motivos:

```text
.env contiene usuario/token Jenkins.
node_modules se reconstruye desde package-lock.json.
reports son salidas de ejecucion.
.npm-cache es cache local de dependencias.
```

## Checklist Git

```bash
git init
git status --short
git check-ignore -v .env node_modules reports/live-progress.json reports/newman-result.json reports/newman-report.html
git add collections environments jenkins public runners reports/.gitkeep server.js package.json package-lock.json .env.example .gitignore README.md docs
git status --short
git commit -m "chore: prepare qa postman runner phase 4"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO>
git push -u origin main
```

Si `git check-ignore` no marca alguno de los archivos sensibles, no hacer commit hasta corregir `.gitignore`.

## Configuracion Jenkins SCM

En Jenkins, crear o editar el job PLAYER:

```text
Tipo: Pipeline
Definition: Pipeline script from SCM
SCM: Git
Repository URL: <URL_DEL_REPOSITORIO>
Credentials: <credencial Git si el repo es privado>
Branch Specifier: */main
Script Path: jenkins/Jenkinsfile.player
Lightweight checkout: enabled
```

## Validacion Jenkins

1. Ejecutar el job PLAYER manualmente desde Jenkins con parametros validos.
2. Confirmar que Jenkins hace checkout del repositorio.
3. Confirmar que `PROJECT_DIR` apunta al workspace SCM del job.
4. Confirmar que `COLLECTION=PLAYER` y `folder` se validan.
5. Confirmar que el stage de dependencias no reinstala si `require('newman')` funciona.
6. Confirmar que se ejecuta `node runners/player.js --environment ... --folder ...`.
7. Confirmar que se generan artefactos en `reports/`.
8. Confirmar que Jenkins archiva artefactos aunque alguno no exista.

## Validacion dashboard HTML

Despues de mover Jenkins a SCM, validar una de estas alternativas:

```text
Alternativa A:
El dashboard y Jenkins comparten el mismo directorio reports/.

Alternativa B:
Jenkins corre en workspace interno y copia reports/ al directorio servido por server.js.

Alternativa C:
server.js se configura para servir reports/ desde el workspace interno de Jenkins montado en Docker/Windows.
```

La validacion final de FASE 4 es:

```text
HTML -> server.js -> Jenkins Job PLAYER desde SCM -> Newman -> live-progress.json -> HTML
```

## Criterio de cierre

FASE 4 queda cerrada cuando:

```text
El repo esta subido a Git.
Jenkins usa Pipeline script from SCM.
Script Path apunta a jenkins/Jenkinsfile.player.
.env, node_modules y reports generados no aparecen como cambios versionables.
La ejecucion PLAYER funciona desde Jenkins.
La ejecucion PLAYER funciona desde el dashboard HTML.
Las optimizaciones pendientes quedan documentadas.
```
