# Semana 4 — Controles de seguridad y privacidad

## Objetivo

CampusOps utiliza datos ficticios para las pruebas de seguridad. Los controles de esta semana buscan evitar que información sensible permanezca expuesta en logs, preferencias, reportes o datos de telemetría después de que la información haya sido ocultada para el usuario.

Los controles implementados se relacionan principalmente con los activos y amenazas definidos en el modelo de amenazas de Semana 03, especialmente:

* **A-02 — Incidencias**
* **A-03 — Fotografías**
* **A-04 — Ubicaciones**
* **A-07 — Credenciales y secretos**
* **A-08 — Registros y reportes**
* **T-03 — Filtrar datos en registros**
* **T-04 — Exponer credenciales**

Los controles de esta semana reducen la exposición accidental de información sensible, pero no sustituyen los controles de autorización definidos para amenazas como T-01 y T-02.

## 1. Relación con el modelo de amenazas

Los controles implementados se relacionan con las amenazas y activos de Semana 03 de la siguiente manera:

| Control implementado     | Activos relacionados   | Amenaza relacionada | Mitigación                                                                                                                                              |
| ------------------------ | ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maskIncidentForViewer`  | A-02, A-04             | T-03                | Evita que información sensible de una incidencia pase directamente a superficies de registro o presentación sin aplicar el ocultamiento correspondiente |
| `safeLogIncidentEvent`   | A-02, A-08             | T-03                | Evita incluir datos sensibles de una incidencia en logs y maneja de forma segura el camino de error                                                     |
| `saveLastViewedIncident` | A-02, A-04, A-08       | T-03                | Conserva en preferencias la representación enmascarada en lugar de los datos sensibles originales                                                       |
| `generateIncidentReport` | A-02, A-04, A-08       | T-03                | Genera reportes a partir de la representación enmascarada                                                                                               |
| `redactForTelemetry`     | A-02, A-03, A-04, A-08 | T-03                | Redacta campos sensibles incluso cuando aparecen dentro de objetos anidados y arreglos                                                                  |
| `redactSecrets`          | A-07, A-08             | T-04                | Sustituye patrones conocidos de credenciales y secretos por `[REDACTED]`                                                                                |
| `scanForSecrets`         | A-07, A-08             | T-04                | Detecta patrones de secretos en los archivos incluidos en el alcance del escaneo                                                                        |

### Relación con T-01 y T-02

El modelo de amenazas de Semana 03 define:

* **T-01 — Consultar incidencias ajenas:** requiere autorización del actor antes de devolver información.
* **T-02 — Alterar asignaciones:** requiere autorización e integridad antes de modificar asignaciones u operaciones.

Los controles de Semana 04 documentados aquí **no se presentan como una implementación completa de esos controles de autorización**. La finalidad de esta semana es proteger las superficies de logs, preferencias, reportes y telemetría y evitar exposición de secretos.

## 2. Ocultamiento de información sensible de incidencias

La función `maskIncidentForViewer` genera una representación de una incidencia según el usuario que la consulta.

El propietario de la incidencia puede visualizar su `reporterId` y la ubicación correspondiente. Para un tercero, estos campos se sustituyen por `[HIDDEN]`.

La función genera una nueva representación y no modifica la incidencia original.

Este comportamiento reduce la posibilidad de que una representación destinada a un tercero conserve información que posteriormente pueda terminar en preferencias, reportes u otras superficies de salida.

Archivo relacionado:

`src/campusops/security/incidentPrivacy.ts`

## 3. Protección de logs

Los eventos relacionados con una incidencia utilizan una representación sanitizada y no incorporan directamente el `reporterId` ni la ubicación sensible cuando esos datos no deben ser visibles.

La función `safeLogIncidentEvent` también maneja el caso de una incidencia inexistente sin propagar una excepción no controlada.

En el camino de error se evita incluir datos de la incidencia en el mensaje generado.

Este control responde directamente a **T-03 — Filtrar datos en registros**, ya que evita que una operación normal o un error conviertan los logs en una copia de información sensible.

## 4. Protección del almacenamiento de preferencias

La función `saveLastViewedIncident` almacena en el preference store la representación enmascarada de la incidencia.

De esta forma, cuando un tercero consulta una incidencia, los datos que fueron ocultados en la interfaz tampoco se conservan en las preferencias en su forma original.

La decisión consiste en minimizar la información sensible persistida en esta ruta.

El preference store no se considera un mecanismo general para almacenar secretos ni sustituye a un mecanismo de almacenamiento cifrado cuando una aplicación requiera conservar información sensible.

## 5. Protección de reportes

La función `generateIncidentReport` genera los reportes utilizando `maskIncidentForViewer`.

Como consecuencia, los datos sensibles que no corresponden al usuario que consulta el reporte permanecen ocultos también en la salida JSON.

Este control evita que la protección aplicada a la representación de la incidencia sea eliminada posteriormente al generar un reporte.

El control se relaciona con **A-08 — Registros y reportes** y con **T-03 — Filtrar datos en registros**.

## 6. Sanitización de telemetría

La función `redactForTelemetry` recorre objetos y arreglos de forma recursiva.

Las claves sensibles se normalizan a minúsculas y se eliminan `_` y `-` antes de compararlas.

Entre las claves protegidas se encuentran:

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

Los valores de estos campos se reemplazan por `[REDACTED]`.

Los campos técnicos no sensibles, como `incidentId`, `correlationId`, `status`, `attempt` y `durationMs`, se conservan para mantener contexto útil para diagnóstico.

La función no modifica el objeto de entrada original.

Archivo relacionado:

`src/course-evaluation/index.ts`

Este control responde a **T-03 — Filtrar datos en registros**, incluyendo el caso en que los datos sensibles no aparecen directamente en el nivel superior del objeto.

## 7. Sanitización de secretos en texto

La función `redactSecrets` sustituye patrones conocidos de credenciales y secretos por `[REDACTED]`.

Se contemplan:

* claves privadas;
* tokens de GitHub;
* claves de acceso AWS;
* encabezados Bearer;
* campos JSON como `password`, `token`, `secret`, `apiKey` y `access_token`.

Este control reduce la posibilidad de que una credencial aparezca directamente en mensajes, errores o información de diagnóstico.

Archivo relacionado:

`src/campusops/security/redact.ts`

Este control se relaciona principalmente con **A-07 — Credenciales y secretos** y **T-04 — Exponer credenciales**.

## 8. Detección de secretos

El control `scanForSecrets` identifica patrones asociados con:

* claves privadas;
* tokens de GitHub;
* claves de acceso AWS;
* variables públicas cuyo nombre contiene `SECRET`, `PRIVATE_KEY` o `ACCESS_TOKEN`.

La prueba de seguridad recorre los archivos incluidos en el alcance del control y excluye los directorios, archivos binarios y archivos de ejemplo definidos por la implementación.

Los casos de prueba utilizan únicamente secretos ficticios para demostrar la capacidad de detección.

Archivo relacionado:

`src/campusops/security/secretScan.ts`

Este control responde directamente a **T-04 — Exponer credenciales**.

## 9. Decisión sobre el almacenamiento

La decisión adoptada es utilizar el preference store existente de CampusOps únicamente para conservar la representación enmascarada de la incidencia.

Se descartó almacenar la incidencia completa en esta ruta porque permitiría conservar en preferencias información que ya fue ocultada al usuario, como `reporterId` y ubicación.

Una alternativa sería utilizar un mecanismo de almacenamiento cifrado para información que realmente requiera persistencia sensible. Sin embargo, el cifrado por sí solo no elimina la necesidad de aplicar sanitización y control de acceso antes de persistir o transmitir información.

La decisión tomada prioriza:

* minimizar los datos sensibles persistidos;
* reutilizar la infraestructura existente;
* mantener el comportamiento esperado de CampusOps;
* evitar que los datos ocultos en la interfaz vuelvan a aparecer en preferencias o reportes.

### Trade-off

La principal ventaja es reducir la cantidad de información sensible que queda persistida en esta ruta sin introducir una nueva infraestructura de almacenamiento.

El costo es que los datos almacenados deben seguir considerándose información que requiere protección. Además, si en el futuro CampusOps necesita persistir información sensible que no pueda representarse de forma sanitizada, deberá evaluarse un mecanismo de almacenamiento seguro apropiado.

## 10. Manejo de errores

El caso de una incidencia inexistente se prueba mediante `safeLogIncidentEvent`.

El comportamiento esperado es:

1. detectar que la incidencia no existe;
2. evitar una excepción no controlada;
3. generar un mensaje de error sin datos sensibles de la incidencia;
4. conservar únicamente el contexto técnico necesario.

Este camino es relevante para **T-03**, porque los controles de privacidad también deben aplicarse cuando ocurre un error y no solamente durante el flujo nominal.

## 11. Riesgo residual

Los controles reducen la exposición de información sensible en las superficies evaluadas, pero no constituyen una solución general de almacenamiento cifrado ni garantizan que cualquier componente futuro de la aplicación aplique sanitización.

El principal riesgo residual es que otra ruta o componente que no utilice las funciones de privacidad o sanitización pueda registrar, persistir o transmitir información sensible.

También permanece el riesgo de que se incorporen nuevas claves sensibles que no estén incluidas en las listas actuales de redacción.

Por este motivo:

* la sanitización debe aplicarse antes de enviar datos a logs, preferencias, reportes o telemetría;
* las listas de campos sensibles deben mantenerse actualizadas;
* los nuevos componentes deben revisarse antes de permitirles registrar o persistir información;
* los controles de autorización de T-01 y T-02 deben mantenerse independientes de estos controles de sanitización.

Las pruebas de esta semana utilizan únicamente datos ficticios.

## 12. Pruebas y verificación

### Suite general de seguridad

Comando:

```text
npm run test:security
```

Resultado observado:

* 6 suites aprobadas.
* 34 pruebas aprobadas.
* 0 suites fallidas.
* 0 pruebas fallidas.

### Detección de secretos

Comando:

```text
npx jest src/campusops/security/t04-secret-scan.test.ts --verbose
```

Resultado observado:

* 1 suite aprobada.
* 5 pruebas aprobadas.

Los casos comprueban la detección de patrones ficticios de secretos y un escenario sin patrones de secretos.

### Persistencia de datos ocultos

Comando:

```text
npx jest src/campusops/security/t05-hidden-data-persistence.test.ts --verbose
```

Resultado observado:

* 1 suite aprobada.
* 8 pruebas aprobadas.

Las pruebas comprueban:

* visualización de datos por el propietario;
* ocultamiento de `reporterId` y ubicación para terceros;
* ausencia de esos datos en logs;
* persistencia de la representación enmascarada;
* generación de reportes sin datos sensibles;
* manejo seguro de una incidencia inexistente;
* conservación de la incidencia original;
* comportamiento correcto del propietario después de un intento fallido previo.

### Sanitización de telemetría

Comando:

```text
npx jest src/campusops/security/t05-telemetry-redaction.test.ts --verbose
```

Resultado observado:

* 1 suite aprobada.
* 3 pruebas aprobadas.

Las pruebas comprueban:

* sanitización de campos sensibles dentro de objetos anidados y arreglos;
* conservación del objeto de entrada original;
* conservación de campos técnicos no sensibles.

## 13. Evidencia asociada

Los resultados reproducibles se conservan en:

* `reports/week-04/negative-tests.json`
* `reports/week-04/secret-scan.json`
* `evidence/week-04/engineering.json`
* `evidence/week-04/individual.json`

Los reportes deben corresponder exactamente a la versión que será evaluada.

Los campos `commitSha` y `generatedAt` deben completarse de acuerdo con el procedimiento definido en `docs/EVIDENCE_CONTRACT.md` y `STARTER_AND_REPOSITORY.md`.

## 14. Conclusión

Los controles implementados en Semana 04 reducen la exposición de información sensible en las superficies evaluadas.

En particular:

* `maskIncidentForViewer` limita la información visible según el contexto del usuario;
* `safeLogIncidentEvent` evita exposición en logs y caminos de error;
* `saveLastViewedIncident` evita persistir la representación sensible original;
* `generateIncidentReport` conserva el ocultamiento en los reportes;
* `redactForTelemetry` sanitiza objetos y estructuras anidadas;
* `redactSecrets` elimina patrones conocidos de credenciales;
* `scanForSecrets` proporciona una comprobación automática frente a secretos en el repositorio.

La evidencia de pruebas debe mantenerse vinculada al SHA final evaluado para asegurar que la documentación, el código y los reportes correspondan a la misma versión.
