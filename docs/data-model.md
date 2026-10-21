# Modelo de datos local y persistencia

## Alcance y estado actual

El dominio ya declara `PendingIncidentOperation` en `src/campusops/contracts.ts`, con `operationId`, `incidentId`, `baseVersion`, `actorId`, `action` y `payload`. El contrato del backend en `course-backend/campusops.mjs` usa la versión base para rechazar escrituras obsoletas y la clave `Idempotency-Key` para reconocer replays. El modelo `Incident` está en `src/campusops/domain/Incident.ts`.

Actualmente no hay en el proyecto una cola duradera de operaciones ni un repositorio local SQLite. Este documento define el modelo objetivo para esa implementación; no afirma que la persistencia offline, las migraciones o su rollback ya estén implementados.

## Requisitos e invariantes

1. Cada operación lógica conserva un `operationId` estable durante todos sus intentos y reinicios.
2. El registro captura el `incidentId`, `baseVersion`, `actorId`, acción y payload exactos que se intentarán sincronizar.
3. No se elimina una operación por un timeout, un fallo de red, un cierre de la app o un conflicto no resuelto.
4. Las notas y referencias a fotografías necesarias para reintentar sobreviven al reinicio.
5. Los bytes de las fotografías viven como archivos locales persistentes; la base almacena referencias, no el contenido binario.
6. Una escritura local de operación y sus referencias a adjuntos es una unidad lógica: no debe quedar una operación con adjunto perdido ni un archivo temporal presentado como evidencia sincronizable.
7. Una actualización de esquema es todo-o-nada. Si falla, la app vuelve a abrir con el esquema y los datos previos intactos.

## Esquema objetivo

Se propone SQLite mediante el adaptador Expo adecuado para la plataforma. Los nombres son conceptuales y pueden adaptarse a las convenciones del repositorio al implementar el adaptador.

### `incidents`

Es la caché local de la última representación conocida de cada incidencia:

| Columna | Tipo | Regla |
|---|---|---|
| `id` | `TEXT` | Clave primaria; ID remoto de la incidencia. |
| `version` | `INTEGER` | Versión remota observada, no negativa. |
| `snapshot_json` | `TEXT` | Representación completa validada del dominio `Incident`. |
| `updated_at` | `INTEGER` | Instante UTC en milisegundos de la última actualización local. |

`Incident.work` se conserva como una unidad de conflicto en la política de sincronización porque contiene tanto asignación como estado (`assignedTechnicianId` y `status`).

### `pending_operations`

| Columna | Tipo | Regla |
|---|---|---|
| `operation_id` | `TEXT` | Clave primaria y clave estable de idempotencia remota. No se regenera en reintentos. |
| `incident_id` | `TEXT` | Referencia a `incidents.id`; conserva el objetivo de la operación. |
| `base_version` | `INTEGER` | Versión del servidor sobre la que se creó el cambio. |
| `actor_id` | `TEXT` | Identidad sintética/estable del autor que el backend debe autorizar. No confiar en el rol recibido desde el cliente. |
| `action` | `TEXT` | Acción del contrato: por ejemplo `start`, `resolve`, `comment` o `add_evidence`. |
| `payload_json` | `TEXT` | Payload exacto e inmutable que acompaña la clave durante los reintentos. Incluye el texto de notas/diagnóstico cuando corresponda. |
| `status` | `TEXT` | `pending`, `in_flight`, `conflicted`, `blocked` o `synced`. |
| `attempt_count` | `INTEGER` | Número de envíos efectuados; no altera la identidad de la operación. |
| `next_attempt_at` | `INTEGER NULL` | Instante UTC para el próximo intento programado. |
| `last_error_code` | `TEXT NULL` | Código técnico permitido; no guardar tokens, secretos ni texto privado del servidor. |
| `created_at` | `INTEGER` | Momento UTC de creación local. |
| `updated_at` | `INTEGER` | Momento UTC del último cambio de estado. |

Índices recomendados: `(status, next_attempt_at, created_at)` para seleccionar trabajo listo y `(incident_id, created_at)` para presentar la cola por incidencia. `operation_id` es único globalmente en el dispositivo.

La fila se inserta con el `base_version` que estaba visible al editar. `payload_json` se considera inmutable después del primer intento; una edición del contenido crea una operación lógica nueva y, por tanto, una nueva clave.

### `operation_attachments`

| Columna | Tipo | Regla |
|---|---|---|
| `attachment_id` | `TEXT` | Clave primaria local, estable. |
| `operation_id` | `TEXT` | Clave foránea a `pending_operations.operation_id`, con borrado en cascada sólo al completar/descartar explícitamente la operación. |
| `evidence_id` | `TEXT NULL` | ID sintético/remoto si ya fue asignado; si no, queda nulo hasta completar la carga. |
| `local_uri` | `TEXT` | URI o ruta relativa dentro del almacenamiento privado persistente de la app. No usar una URI temporal del selector de fotos. |
| `mime_type` | `TEXT` | Tipo MIME validado. |
| `sha256` | `TEXT` | Hash para detectar que el archivo local no cambió ni desapareció. |
| `size_bytes` | `INTEGER` | Tamaño esperado del archivo. |
| `status` | `TEXT` | `staged`, `ready`, `uploading`, `uploaded` o `missing`. |
| `created_at` | `INTEGER` | Momento UTC de registro. |

Las referencias se ordenan por `attachment_id` o posición explícita para reconstruir la petición. Una operación `add_evidence` sólo se puede enviar cuando su archivo esté disponible y la referencia/ID que exige el contrato esté resuelta.

## Escritura local y recuperación de adjuntos

1. Copiar primero cada fotografía a un archivo temporal dentro del directorio privado persistente de la app; comprobar existencia, tamaño y hash.
2. En una transacción SQLite, insertar la operación pendiente y sus referencias de adjunto en estado `staged`.
3. Finalizar los archivos staged con un rename atómico en el mismo volumen y marcar referencias como `ready` en una transacción corta.
4. Si hay un fallo antes de confirmar el paso 2, limpiar sólo los temporales creados por esa operación. Si el proceso se interrumpe entre pasos, la rutina de recuperación al iniciar compara temporales y referencias: completa la promoción si los archivos están íntegros; si no, marca la operación `blocked` y conserva el registro para recuperación explícita.
5. No borrar el archivo hasta que el servidor confirme la operación y la transacción local que marca `synced` se confirme. Un archivo ausente no se reemplaza con una referencia inventada: se informa como `missing`.

Las notas y diagnósticos son parte de `payload_json` y no se separan de la operación. El almacenamiento y la retención de texto siguen las reglas de privacidad del proyecto.

## Migraciones atómicas

Mantener un entero `user_version` de SQLite como versión del esquema. Cada migración `N -> N+1` debe:

1. Abrir la base y leer `user_version`; bloquear las escrituras de la cola hasta terminar la migración.
2. Iniciar una transacción SQLite (`BEGIN IMMEDIATE` o la transacción equivalente del adaptador).
3. Crear o modificar tablas/índices, copiando datos de tablas antiguas antes de retirar columnas o tablas obsoletas. No borrar la cola existente como estrategia de migración.
4. Validar dentro de la transacción las claves, recuentos, JSON requeridos y referencias a adjuntos.
5. Actualizar `user_version` sólo después de validar todos los datos y confirmar con `COMMIT`.
6. Si cualquier paso falla, ejecutar `ROLLBACK`, cerrar la conexión y dejar visible el error. Al siguiente inicio, reintentar desde la versión antigua; no iniciar sincronización con una migración incompleta.

SQLite revierte las operaciones transaccionales de esquema y datos al fallar la transacción. Para migraciones que involucren archivos, no mover ni borrar archivos fuente antes del commit; usar archivos staged y una rutina de recuperación idempotente como la descrita arriba. Antes de cambios destructivos de formato se recomienda conservar una copia de seguridad consistente con la base cerrada o mediante la API de backup del motor.

## Recuperación operativa

- La app no elimina la única copia de una operación pendiente frente a un error de migración. Debe bloquear escrituras/sincronización con un error visible y preservar la base previa.
- Si la restauración encuentra una fila inválida, ponerla en cuarentena o marcarla `blocked` sin descartar otros registros válidos.
- Un conflicto conserva tanto la operación local como la última representación remota; el tratamiento se rige por `docs/sync-policy.md`.
- Los logs pueden incluir `operation_id` sólo si es un identificador no sensible, estado e instancia del error. Nunca registrar tokens, contenido de notas, URI privada o datos de fotografía.

## Verificación prevista para la implementación

La implementación deberá tener pruebas automatizadas sin dependencias de red ni esperas artificiales que comprueben: persistencia y lectura tras reconstruir el repositorio (simulación de reinicio), notas y referencias a fotografías, migración que conserva filas de cola, fallo inducido a mitad de migración con restauración exacta de versión/datos previos y recuperación de adjuntos staged. Registrar los comandos realmente ejecutados y su salida en la evidencia de semana 8; este documento por sí solo no acredita esos tests.