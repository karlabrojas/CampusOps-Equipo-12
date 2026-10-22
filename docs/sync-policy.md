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
