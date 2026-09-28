# Semana 4 — Controles de seguridad y privacidad

## Objetivo

CampusOps utiliza datos ficticios para las pruebas de seguridad. Los controles de esta semana buscan evitar que información sensible permanezca en logs, preferencias, reportes o datos de telemetría después de que la información haya sido ocultada para el usuario.

## Controles implementados

### 1. Ocultamiento de información sensible de incidencias

La función `maskIncidentForViewer` genera una representación de una incidencia según el usuario que la consulta.

El propietario de la incidencia puede visualizar su `reporterId` y la ubicación. Para un tercero, esos campos se sustituyen por `[HIDDEN]`.

La función devuelve una nueva representación y no modifica la incidencia original.

Archivo relacionado:

`src/campusops/security/incidentPrivacy.ts`

### 2. Protección de logs

Los eventos de una incidencia utilizan la representación sanitizada y no incorporan directamente el `reporterId` ni la ubicación sensible.

Además, `safeLogIncidentEvent` maneja el caso de una incidencia inexistente sin propagar una excepción y evita incluir datos de la incidencia en el mensaje de error.

### 3. Protección del almacenamiento de preferencias

`saveLastViewedIncident` almacena en el preference store la representación enmascarada de la incidencia.

De esta forma, cuando un tercero consulta una incidencia, los datos que fueron ocultados en la interfaz tampoco se conservan en el almacenamiento de preferencias en su forma original.

### 4. Protección de reportes

`generateIncidentReport` genera los reportes utilizando `maskIncidentForViewer`.

Los datos sensibles que no corresponden al usuario que consulta el reporte permanecen ocultos también en la salida JSON.

### 5. Sanitización de telemetría

`redactForTelemetry` recorre objetos y arreglos de forma recursiva.

Las claves sensibles se normalizan a minúsculas y se eliminan `_` y `-` antes de compararlas. Entre las claves protegidas se encuentran:

* `authorization`
* `password`
* `token`
* `accessToken`
* `refreshToken`
* `email`
* `displayName`
* `name`
* `userId`
* `reporterId`
* `technicianId`
* `assignedTechnicianId`
* `location`
* `latitude`
* `longitude`
* `photos`
* `evidence`
* `internalComments`
* `assignmentHistory`

Los valores sensibles se reemplazan por `[REDACTED]`.

Los campos técnicos no sensibles, como `incidentId`, `correlationId`, `status`, `attempt` y `durationMs`, se conservan.

La función no modifica el objeto de entrada.

Archivo relacionado:

`src/course-evaluation/index.ts`

### 6. Sanitización de secretos en texto

`redactSecrets` sustituye patrones de credenciales y secretos conocidos por `[REDACTED]`.

Se contemplan claves privadas, tokens de GitHub, claves de acceso AWS, encabezados Bearer y campos JSON como `password`, `token`, `secret`, `apiKey` y `access_token`.

Archivo relacionado:

`src/campusops/security/redact.ts`

### 7. Detección de secretos

El control `scanForSecrets` identifica patrones de:

* claves privadas;
* tokens de GitHub;
* claves de acceso AWS;
* variables públicas cuyo nombre contiene `SECRET`, `PRIVATE_KEY` o `ACCESS_TOKEN`.

La prueba de seguridad también recorre el repositorio y excluye directorios, archivos binarios y archivos de ejemplo definidos por el control.

Archivo relacionado:

`src/campusops/security/secretScan.ts`

## Manejo de errores

El caso de una incidencia inexistente se prueba mediante `safeLogIncidentEvent`.

El control esperado es:

1. detectar que la incidencia no existe;
2. evitar una excepción no controlada;
3. generar un mensaje de error que no incluya datos sensibles de la incidencia.

La prueba de persistencia de datos ocultos verifica este comportamiento.

## Riesgo residual

Los controles reducen la exposición de información sensible en las superficies evaluadas, pero no constituyen una solución general de almacenamiento cifrado.

El riesgo residual es que otras rutas o componentes que no utilicen las funciones de sanitización puedan registrar o persistir información sensible. Por ello, la sanitización debe aplicarse antes de enviar datos a logs, preferencias, reportes o telemetría.

Las pruebas de esta semana utilizan únicamente datos ficticios.

## Verificación ejecutada

Las pruebas de seguridad ejecutadas fueron:

```text
npm run test:security
```

Resultado observado:

* 6 suites aprobadas.
* 34 pruebas aprobadas.
* 0 suites fallidas.
* 0 pruebas fallidas.

También se ejecutaron específicamente:

```text
npx jest src/campusops/security/t04-secret-scan.test.ts --verbose
```

Resultado:

* 1 suite aprobada.
* 5 pruebas aprobadas.

```text
npx jest src/campusops/security/t05-hidden-data-persistence.test.ts --verbose
```

Resultado:

* 1 suite aprobada.
* 8 pruebas aprobadas.

```text
npx jest src/campusops/security/t05-telemetry-redaction.test.ts --verbose
```

Resultado:

* 1 suite aprobada.
* 3 pruebas aprobadas.
