# Semana 8 — Conservar el trabajo sin conexión y resolver conflictos

**Actividad:** Persistencia íntegra y sincronización. **Valor:** 8 puntos. **Equipo:** 3 integrantes.

Disponible del **20 de octubre de 2026 a las 08:00** al **26 de octubre de 2026 a las 23:59**, hora de Ciudad de México.

## El resultado que buscamos

Un técnico inicia una atención sin conexión mientras coordinación reasigna la incidencia. Esta semana CampusOps deberá conservar ambos hechos y detectar el conflicto, sin perder cambios ni imponer una asignación antigua.

## Antes de empezar

Retomen el mismo repositorio después del Parcial 1. Mantengan el cliente, la sesión segura, la validación y las pruebas acumuladas; cambiar de parcial no reinicia el proyecto.

Usen el mismo repositorio y stack: **React Native + Expo + TypeScript**. Instalen el ZIP `week-08-persistencia-sincronizacion.zip` siguiendo `STARTER_AND_REPOSITORY.md`. Lean el alcance en `docs/CAMPUSOPS.md` y el contrato público en `docs/CAMPUSOPS_API.md`. Mantengan las funciones y controles acumulados: avanzar de semana no permite desactivar lo anterior. Si una dificultad previa les impide continuar, repórtenla al docente con evidencia del problema para recibir apoyo.

## ¿Qué deben hacer?

### 1. Definan los datos y la cola local

Documenten el modelo y almacenen los cambios pendientes con identidad estable, incidencia, versión base y autor. Las notas y referencias a fotografías pendientes deben seguir siendo utilizables después de reiniciar, no sólo mientras la app permanece abierta.

### 2. Prueben una migración recuperable

Comprueben cómo cambia el esquema de datos sin perder información ni la cola. Si falla una transacción, no debe quedar una migración a medias. Demuestren la recuperación o rollback con pruebas aisladas y repetibles.

### 3. Detecten el conflicto de reasignación

Prueben el inicio local de atención frente a la reasignación remota. No sobrescriban la asignación nueva ni descarten la intención pendiente. Justifiquen cómo informarán y resolverán el conflicto. En los adaptadores, work agrupa asignado y estado; eso no obliga a copiar ese modelo en la base de datos.

### 4. Sincronicen sin duplicar operaciones

Integren resolveSync y deduplicateOperations con la aplicación. Combinen cambios independientes, informen los incompatibles y mantengan las entradas originales. Repitan una operación con la misma identidad y demuestren que no duplica el efecto; retiren de la cola sólo lo confirmado.

## Términos que usarán

- **Persistencia:** Almacenamiento que conserva información después de cerrar o reiniciar la app.
- **Migración:** Cambio de estructura de datos que debe conservar la información existente.
- **Rollback:** Recuperación del estado anterior cuando una operación no puede completarse.
- **Operación atómica:** Operación que se completa entera o no deja un resultado parcial.
- **Idempotencia:** Repetir la misma operación no vuelve a producir su efecto.

## ¿Qué archivos deben entregar?

Las rutas son relativas a la raíz del repositorio. Además del código y las pruebas del hito, deben quedar estos archivos:

| Archivo | Qué debe contener |
|---|---|
| `docs/data-model.md` | Modelo de datos, persistencia y migración de la información y de la cola. |
| `docs/sync-policy.md` | Política de sincronización, conflictos, reintentos y conservación de cambios pendientes. |
| `reports/week-08/migration-tests.json` | Pruebas de migración, rollback, reinicio, conflicto y operaciones repetidas. |
| `evidence/week-08/engineering.json` | Decisión justificada, alternativas, beneficios y costos, requisito y comprobación relacionada. |
| `evidence/week-08/individual.json` | Un registro técnico por integrante; los tres se reúnen en un solo archivo. |

**Decisión que deben justificar:** Justifiquen la política de conflicto e idempotencia: qué se conserva, qué se combina y qué requiere resolución.

El formato de reportes, campos JSON y evidencia individual se explica en `STARTER_AND_REPOSITORY.md` y `docs/EVIDENCE_CONTRACT.md`. No basta con crear archivos vacíos o escribir que las pruebas pasaron: conserven comandos y observaciones reales.

## ¿Cómo comprueban y entregan?

Sigan el orden completo de `STARTER_AND_REPOSITORY.md`: guarden el código, completen evidencias, ejecuten `make feedback`, `make verify-week-08` y `make public-test-week-08`, y guarden el commit exclusivo de reportes/evidencias. Después creen la etiqueta **`week-08-final`** y ejecuten **`make evidence-week-08`**. Ese último comando necesita que la etiqueta ya exista.

Cuando las comprobaciones pasen, suban la versión y la etiqueta a GitHub. En Classroom entreguen **el enlace del repositorio, `week-08-final` y su SHA completo**. El SHA identifica exactamente la versión que se calificará; los cambios posteriores no forman parte de esa entrega. No basta con adjuntar capturas o guardar el proyecto sólo en su computadora.

La guía de entrega también está en el ZIP como `docs/assignments/week-08-repository.md`.

## ¿Cómo se califica?

- **AC-01 — 2.5 puntos:** instalación y verificación reproducibles desde la versión entregada.
- **AC-02 — 2 puntos:** La migración, la cola persistente, la sincronización y los reintentos preservan integridad; se demuestra recuperación tras reiniciar y conflicto sin pérdida silenciosa.
- **AC-03 — 1.5 puntos:** Demuestren que no se pierden ni duplican datos y que una transacción fallida no deja el estado parcialmente migrado.
- **AC-04 — 1.5 puntos:** decisión técnica justificada y relacionada con una prueba y su resultado.
- **AC-05 — 0.5 puntos:** aportación técnica individual verificable y explicación cuando se solicite.

**Total: 8 puntos.** Lean `RUBRIC_PUBLIC.md` para los niveles completo, parcial y sin crédito y para las condiciones que limitan la calificación. El ZIP la incluye en `docs/assignments/week-08-rubric.md`.

## Cómo se obtiene tu calificación

La actividad **no se califica por cantidad de archivos ni por número de commits**. Se suman cinco criterios independientes y el resultado máximo es **8 puntos**:

1. **AC-01 — 2.5 puntos, automático.** Se fija tu tag/SHA y se reproduce el proyecto. El nivel completo requiere instalación y checks obligatorios reproducibles; una deficiencia no crítica reproducible es parcial; sin reproducción o con el check central fallido no hay crédito.
2. **AC-02 — 2 puntos, automático.** Se ejecutan las pruebas públicas y los casos declarados. El nivel completo requiere demostrar el comportamiento completo y sus límites; el nivel parcial significa que el flujo principal funciona pero falla un caso límite. En este hito se busca: La migración, la cola persistente, la sincronización y los reintentos preservan integridad; se demuestra recuperación tras reiniciar y conflicto sin pérdida silenciosa.
3. **AC-03 — 1.5 puntos, automático.** Se reproduce la falla declarada y se revisa su manejo. El nivel completo requiere una corrección segura y evidencia útil; evidencia incompleta es parcial; un cierre inesperado, bucle, corrupción o exposición no obtiene crédito. Para esta semana deben demostrar: Demuestren que no se pierden ni duplican datos y que una transacción fallida no deja el estado parcialmente migrado.
4. **AC-04 — 1.5 puntos, semiautomático.** Se valida `engineering.json` y se contrasta con el repositorio. El nivel completo conecta requisito, alternativas, decisión, trade-off, prueba y resultado; un documento genérico o contradictorio no obtiene crédito. La decisión central es: Justifiquen la política de conflicto e idempotencia: qué se conserva, qué se combina y qué requiere resolución.
5. **AC-05 — 0.5 puntos, semiautomático.** Se revisa `individual.json` y la señal técnica de cada integrante. El nivel completo es una aportación verificable y explicable; una señal limitada pero coherente es parcial; la ausencia de evidencia no obtiene crédito. Los flags y la muestra rotativa sólo activan corroboración: no son un descuento automático.

Los tres primeros criterios suman **6 puntos automáticos** y los dos últimos **2 puntos semiautomáticos**. No hay puntos manuales rutinarios. Los quality gates son límites, no descuentos adicionales; si coinciden varios, se aplica una sola vez el límite más restrictivo. La rúbrica no asigna un porcentaje inventado al nivel parcial: el resultado se determina por la evidencia observada en cada criterio.

GitHub Actions ofrece retroalimentación; la calificación final se obtiene al verificar la versión entregada. No usen secretos ni datos reales, no alteren pruebas para forzar éxito y no sustituyan evidencia ejecutable con capturas. Mantengan las políticas de IA y evidencia individual explicadas en la guía de entrega.

## Antes de cerrar esta semana

- Comprueben el funcionamiento requerido y el caso de falla, no sólo el camino exitoso.
- Revisen que código, documentos y reportes describan la misma versión.
- Confirmen la aportación de los tres integrantes y el envío de etiqueta y SHA.
- Cada integrante debe responder el **quiz semanal 8** por separado: **3 preguntas, 2 puntos**, adicionales a los 8 de esta actividad. Ambos forman parte de la evaluación continua.
