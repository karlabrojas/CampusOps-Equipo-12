# Modelo de datos local y persistencia

## Alcance y estado actual

El dominio declara `PendingIncidentOperation` en `src/campusops/contracts.ts`, con `operationId`, `incidentId`, `baseVersion`, `actorId`, `action` y `payload`. La persistencia se implementa en `src/campusops/infrastructure/localSyncStore.ts`; el esquema versionado y sus migraciones están en `sqliteMigrations.ts`. El adaptador usa Expo SQLite y la base local `campusops-local.db`. El backend en `course-backend/campusops.mjs` rechaza versiones obsoletas y deduplica replays mediante `Idempotency-Key`.

Las fotografías se copian a almacenamiento privado persistente mediante `ExpoAttachmentFileStore` en `attachmentFiles.ts`. El contenido de notas permanece en el payload de la operación. La implementación y las pruebas no sustituyen una política de backup del sistema operativo; la garantía se refiere a persistencia dentro del almacenamiento privado de la app, sujeto a que Android/iOS no elimine los datos de la app.

## Requisitos e invariantes

1. Cada operación lógica conserva un `operationId` estable durante todos sus intentos y reinicios.
2. El registro captura el `incidentId`, `baseVersion`, `actorId`, acción y payload exactos que se intentarán sincronizar.
3. No se elimina una operación por un timeout, un fallo de red, un cierre de la app o un conflicto no resuelto.
4. Las notas y referencias a fotografías necesarias para reintentar sobreviven al reinicio.
5. Los bytes de las fotografías viven como archivos locales persistentes; la base almacena referencias, no el contenido binario.
6. Una escritura local de operación y sus referencias a adjuntos es una unidad lógica: no debe quedar una operación con adjunto perdido ni un archivo temporal presentado como evidencia sincronizable.
7. Una actualización de esquema es todo-o-nada. Si falla, la app vuelve a abrir con el esquema y los datos previos intactos.

## Esquema implementado

La versión actual es **2**, almacenada en `PRAGMA user_version`. La migración inicial crea snapshots y operaciones; la migración 2 añade estados/reintentos y la tabla de referencias a adjuntos.

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
| `incident_id` | `TEXT` | ID de la incidencia objetivo. Se valida al crear la operación; no es una FK porque una operación offline puede crearse antes de cachear el snapshot. |
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

Índices implementados: `(status, next_attempt_at, created_at)` para seleccionar trabajo y `(incident_id, created_at)` para presentar la cola por incidencia. `operation_id` es clave primaria y único en la base.

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

1. Copiar cada fotografía a un nombre estable bajo `documentDirectory/campusops/evidence/<operationId>/<attachmentId>` usando un archivo `.staged`; comprobar tamaño e integridad antes de promoverlo mediante rename.
2. Insertar la operación y todas sus referencias listas en una única transacción SQLite. Si la transacción falla, eliminar los archivos preparados y propagar el error.
3. Al abrir el almacén, verificar existencia, tamaño y hash de cada adjunto no sincronizado. Un archivo desaparecido o alterado cambia la referencia a `missing` y bloquea la operación (`attachment_missing`) sin borrarla.
4. La recuperación elimina archivos sin referencia a filas SQLite, incluidos temporales huérfanos de una interrupción antes del commit. Las referencias registradas pero no íntegras se conservan para resolución explícita.
5. Después de que el servidor confirme, `markOperationSynced` marca la operación y elimina las referencias en una transacción; luego borra los archivos. Si el borrado del archivo falla, queda huérfano para la limpieza del próximo inicio.

Las notas y diagnósticos son parte de `payload_json`. El código rechaza reutilizar un `operationId` con contenido distinto; reintentos exactos conservan la identidad. El hash implementado se calcula sobre la representación Base64 del archivo y sirve como verificación de integridad al volver a leerlo.

## Migraciones atómicas

Mantener un entero `user_version` de SQLite como versión del esquema. Cada migración `N -> N+1` debe:

1. Abrir la base y leer `user_version`; el almacén no se entrega al resto de la aplicación hasta terminar las migraciones.
2. Ejecutar cada paso con `withExclusiveTransactionAsync`; el motor gestiona `BEGIN`/`COMMIT`/`ROLLBACK`.
3. Crear o modificar tablas/índices, copiando datos de tablas antiguas antes de retirar columnas o tablas obsoletas. No borrar la cola existente como estrategia de migración.
4. Dejar que las restricciones declaradas por el esquema validen cada escritura de migración; agregar validaciones de aplicación cuando una migración transforme datos.
5. Actualizar `user_version` después de que todos los pasos de la versión hayan terminado correctamente, dentro de la misma transacción exclusiva.
6. Si cualquier paso falla, la transacción exclusiva hace rollback; `openMigratedLocalDatabase` cierra la conexión y propaga el error. Al siguiente inicio se vuelve a intentar desde la versión antigua; no se abre el almacén para sincronización parcial.

SQLite revierte cambios de esquema y datos al fallar la transacción. La suite `src/campusops/infrastructure/localSyncStore.test.ts` crea un esquema v1 con operación existente, inyecta un fallo después de añadir columnas en v2, verifica que `user_version` y la fila antigua quedan intactos y luego repite la migración correctamente.

## Recuperación operativa

- Un error de migración se propaga y la base no se expone al repositorio; las operaciones previas permanecen intactas.
- Si una fotografía no existe o no coincide con el tamaño/hash guardado, su operación queda `blocked` sin descartar el payload.
- `markOperationConflicted` actualiza el snapshot remoto y marca la operación como `conflicted` dentro de una transacción, manteniendo su identidad y payload.
- Los logs pueden incluir `operation_id` sólo si es un identificador no sensible, estado e instancia del error. Nunca registrar tokens, contenido de notas, URI privada o datos de fotografía.

## Verificación

Las pruebas usan SQLite real compilado a WebAssembly (`sql.js`) con transacciones, y filesystem controlable en memoria; no dependen de red ni usan `sleep`. Cubren persistencia mediante exportar/reabrir la base (simulación de reinicio), notas, adjuntos, checksum, conflictos, conservación de filas v1, fallo de migración con rollback y repetición exitosa. Ejecución verificada: `npm test -- --runInBand src/campusops/infrastructure/localSyncStore.test.ts course-tests/public/week-08.test.ts` (2 suites, 14 pruebas aprobadas); `npm run typecheck` (sin errores); y ESLint focalizado sobre los archivos TypeScript de la implementación (sin errores ni advertencias).