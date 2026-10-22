# Política de resolución de conflictos de sincronización

## Objetivo

Evitar que las operaciones iniciadas sin conexión sobrescriban cambios más recientes realizados por coordinación en CampusOps.

## Datos utilizados

Cada operación pendiente conserva su `operationId`, `incidentId`, `baseVersion`, `actorId`, `action` y `payload`. La resolución compara el estado base con el estado local y el estado remoto disponible.

## Política de resolución

### Cambios independientes

Si los cambios local y remoto afectan campos distintos, se combinan automáticamente. Por ejemplo, una modificación local de la descripción puede combinarse con una reasignación remota.

### Cambios incompatibles

Si ambos lados modifican el mismo campo con valores diferentes, la operación se marca como conflicto. Los campos conflictivos se reportan en orden alfabético.

En CampusOps, `work` contiene tanto `assignedTechnicianId` como `status`. Por ello, el inicio local de una atención y la reasignación remota de esa misma incidencia se consideran incompatibles cuando producen valores diferentes en `work`.

### Conservación de la operación pendiente

Detectar un conflicto no autoriza a eliminar la operación local ni a sobrescribir el estado remoto. La operación pendiente debe conservar su identidad y sus datos hasta que el conflicto se resuelva explícitamente.

La detección de conflictos no sustituye el almacenamiento persistente de la cola. La implementación responsable de esa cola debe conservar las operaciones pendientes después de un conflicto y permitir su recuperación tras reiniciar la aplicación.

## Resolución e intervención

Cuando existe un conflicto incompatible, se requiere intervención antes de reintentar la operación. La persona responsable debe consultar el estado remoto actual y decidir si corresponde mantener la reasignación, solicitar una nueva asignación o crear una operación compatible con el estado vigente.

No se debe reintentar automáticamente una operación con una versión base obsoleta.

## Reintentos

Las operaciones que se reintenten deben mantener un identificador estable de idempotencia. Si el servidor rechaza una operación porque cambió la versión de la incidencia, debe recuperarse el estado actual y volver a evaluar la operación; no se debe forzar el envío de la versión obsoleta.

## Alternativas consideradas

1. **Priorizar siempre el estado local:** se descarta porque puede sobrescribir una reasignación más reciente.
2. **Priorizar siempre el estado remoto y eliminar el cambio local:** se descarta porque pierde silenciosamente la intención del técnico.
3. **Combinar cambios independientes y reportar conflictos incompatibles:** se adopta porque preserva los cambios compatibles y exige una decisión explícita cuando no es seguro combinarlos.

## Limitaciones

La comparación por campos detecta conflictos en el nivel representado por `SyncRecord.fields`. Como `work` agrupa asignación y estado, los cambios incompatibles dentro de ese objeto se reportan como conflicto en `work`, no como conflictos separados por propiedad.

La función de resolución no persiste la cola, no realiza llamadas al servidor y no resuelve automáticamente los conflictos. La persistencia, la autorización y la validación de versión deben mantenerse en sus respectivas capas.
# Política de sincronización offline

## Alcance y relación con el código actual

`PendingIncidentOperation` en `src/campusops/contracts.ts` define la identidad (`operationId`), incidencia, `baseVersion`, autor, acción y payload de cada cambio pendiente. El backend de `course-backend/campusops.mjs` compara `baseVersion` con la versión actual y responde `409 version_conflict` si no coincide. También deduplica el replay mediante `Idempotency-Key`, siempre que se reutilicen la misma clave y el mismo contenido.

La aplicación todavía no cuenta con una cola local durable ni un coordinador de sync integrado. Este documento define el comportamiento objetivo; no afirma que la resolución de conflictos o los reintentos ya estén implementados.

## Principios

1. **Persistir antes de enviar:** una acción offline se guarda localmente junto con su `operationId`, versión base, actor, payload y adjuntos necesarios antes de intentar la red.
2. **Identidad y contenido estables:** todos los reintentos de una misma operación envían el mismo `operationId` y exactamente el mismo payload. No se genera otra clave al reintentar.
3. **No asumir éxito ante timeout:** la conexión puede perder la respuesta después de que el servidor haya aplicado el cambio. El cliente reenvía la misma operación; el backend debe reconocer el replay.
4. **No descartar ante conflicto:** conservar el cambio local pendiente y guardar/mostrar la última asignación y versión remotas.
5. **No sobrescribir silenciosamente:** toda resolución que cambie la intención local requiere una decisión explícita y una nueva operación.
6. **Orden por incidencia:** sincronizar una operación por incidencia a la vez para que las versiones base se apliquen en orden; incidencias diferentes pueden progresar independientemente.

## Ciclo de una operación

1. Capturar la versión de la incidencia mostrada al usuario (`baseVersion`), `actorId`, acción y payload.
2. Generar una sola clave `operationId`; escribir la operación y sus referencias de foto durablemente.
3. Al sincronizar, comprobar que los adjuntos referenciados están disponibles. Enviar la operación con `Idempotency-Key: operationId` y la versión base requerida por el contrato de acciones.
4. En respuesta exitosa, actualizar la caché con la incidencia y la versión devueltas por el servidor; marcar la operación `synced` en una transacción local y sólo entonces permitir la limpieza de archivos ya confirmados.
5. Ante timeout, pérdida de conexión o respuesta incierta, conservar payload, adjuntos y clave; programar reintento.
6. Ante `409 version_conflict`, descargar la versión remota y aplicar las reglas de conflicto que siguen. No repetir automáticamente el mismo payload/baseVersion como si fuera a resolver el conflicto.

## Reconciliación y conflictos

Comparar `base`, `local` y `remote` por contenido, usando la representación de dominio y no la identidad de objetos:

- Sólo cambió remoto: aceptar su valor en la caché.
- Sólo cambió local: conservar la intención local y preparar el envío con la política de versión vigente.
- Cambios independientes: combinar sólo si pertenecen a campos distintos y la combinación no viola reglas del dominio.
- Cambió el mismo campo de manera distinta en local y remoto: declarar conflicto; conservar ambos valores y no elegir uno silenciosamente.

En CampusOps, `work` agrupa `assignedTechnicianId` y `status`; por lo tanto, se trata como una unidad de conflicto. No se combinan automáticamente un cambio local de estado con una reasignación remota.

### Caso obligatorio: inicio local y reasignación remota

Estado base: incidencia versión `v` asignada al técnico A. Mientras el dispositivo está offline, A crea `start` con `baseVersion = v`. En el servidor, coordinación reasigna a técnico B, produciendo una versión más reciente.

Cuando el dispositivo recupera conexión:

1. El backend rechaza el inicio basado en `v` si la versión actual ya avanzó; registrar el conflicto y obtener el snapshot remoto actual.
2. Guardar y presentar la asignación remota vigente a B y su versión. No mostrar la caché anterior como si A siguiera asignado.
3. Mantener intacta la operación de inicio de A en la cola como `conflicted`/requiere resolución. No borrarla ni reescribir su actor, asignación o `baseVersion`.
4. No reenviar `start` automáticamente con la versión nueva: la reasignación puede quitar autorización al técnico A, así que el backend podría responder `403`; incluso si responde de otra forma, avanzar el estado podría contradecir la decisión de coordinación.
5. Presentar el conflicto al usuario o al flujo de coordinación. La opción predeterminada segura es mantener la última asignación remota y no aplicar el inicio antiguo.
6. Si una persona autorizada decide volver a asignar a A o descartar el inicio, registrar esa resolución explícita. Una operación corregida con payload/base distintos recibe un `operationId` nuevo; conservar el original como resuelto/descartado para auditoría local.

Este flujo preserva simultáneamente la intención pendiente y la asignación más reciente; no las fusiona en una versión ficticia.

## Reintentos y errores

Los reintentos son acotados, persistidos y sin `sleep` de larga duración en el proceso de UI: almacenar `attempt_count` y `next_attempt_at`, reanudar el plan al iniciar y usar backoff exponencial con límite y jitter. Respetar `Retry-After` válido en respuestas `429`. El cálculo debe ser inyectable/determinista en pruebas.

| Resultado | Tratamiento |
|---|---|
| Sin red, timeout o `5xx` | Resultado incierto o temporal: retener operación y adjuntos; reintentar con el mismo `operationId` y payload, dentro del límite. |
| `429` | Retener y reprogramar según `Retry-After` válido, limitado por la política del cliente. |
| `401` | Pausar sync y renovar sesión por el gestor de sesión; tras renovación válida continuar sin alterar la identidad de la operación. Si falla, detener sync y pedir login. |
| `403` | No reintentar automáticamente; estado `blocked`/resolución de permisos. No cambiar actor para forzar autorización. |
| `404` | Marcar bloqueada y solicitar reconciliación de la incidencia; no descartar los datos locales. |
| `409 version_conflict` | Descargar remoto, preservar cola y resolver explícitamente según la comparación de versiones/campos. |
| `409 idempotency_key_reused` | Error de integridad: no generar replay automático con payload distinto; conservar evidencia y reportar. |
| `422` u otro error de contrato/dominio | Bloquear para corrección explícita; no repetir sin cambio de entrada. |
| Límite de intentos alcanzado | Mantener la operación y hacer visible su estado; nunca eliminarla silenciosamente. |

Una operación corregida no puede reutilizar la clave anterior con un cuerpo distinto: el contrato del backend interpreta eso como reutilización inválida. Un retry exacto sí conserva la clave para evitar duplicar efectos.

## Resolución y conservación de fotos/notas

Las notas, diagnósticos y otros campos de la intención local permanecen en el payload persistido hasta confirmación o descarte explícito. Las fotos se conservan como archivos privados persistentes con referencias locales estables y hash/tamaño verificables, siguiendo `docs/data-model.md`; una URI temporal del selector no es suficiente.

Si un archivo falta o no coincide con su hash, bloquear esa operación y pedir restaurar/retirar el adjunto mediante una edición explícita. No sustituirlo por un archivo distinto ni marcarlo como sincronizado.

## Evidencia y pruebas requeridas

La implementación debe comprobar, con almacenamiento y transporte controlables y sin pausas artificiales:

- misma clave/cuerpo en replay después de un timeout;
- operación, nota y referencias a fotografías preservadas tras reinicializar el repositorio;
- escenario `start` local contra `assign` remoto, con la operación pendiente conservada y la asignación remota actualizada;
- conflicto que no reintenta automáticamente el cambio de `work`;
- respuestas `401`, `403`, `409`, `422`, `429`, `5xx` y timeout con la política correspondiente;
- no eliminar adjuntos antes de confirmar el cambio local de estado `synced`.

Los comandos y resultados deben ser los realmente ejecutados y registrados en la evidencia de semana 8. Esta política no sustituye la implementación ni la evidencia de pruebas.
