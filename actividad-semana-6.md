# Actividad Semana 6

Nombre:
Angel
Grupo:
CampusOps - Equipo 12

## 1. Inspección de mi proyecto

| Elemento | Archivo o ubicación real en mi proyecto | ¿Qué hace? |
|---|---|---|
| Cliente HTTP | `src/api/campusOpsClient.ts` | Define el cliente de CampusOps y envía peticiones autenticadas con `Authorization: Bearer ${session.accessToken}`. |
| Access token | `src/api/campusOpsClient.ts` (`CampusOpsSession.accessToken`) | Almacena el token activo que se incluye en cada llamada autenticada. |
| Refresh token | `No está implementado.` | El proyecto no define un `refreshToken` real en la sesión o el cliente. |
| Manejo de 401 | `src/course-evaluation/index.ts` (`coordinateRefresh`) | Reduce eventos de prueba `request401`, `refreshSucceeded` y `refreshFailed` a un resumen del estado; no intercepta respuestas HTTP. |
| Cierre de sesión | `src/course-evaluation/index.ts` (`coordinateRefresh`, evento `logout`) | El evento limpia el token modelado y deja el estado como `anonymous`; no implementa navegación de la app. |

## 2. Mi predicción

A = `GET /profile`
B = `GET /incidents`
C = `GET /assignments`

Cantidad de refresh que espero: 1 para la secuencia simulada (predicción previa a ejecutar).

Explicación:
En `src/course-evaluation/index.ts` observé que cada `request401` agrega su identificador a `retriedRequestIds`, mientras `refreshSucceeded` incrementa `refreshCalls` y actualiza `persistedToken`. Predije un refresh porque en la prueba se envía un único evento de refresh después de los tres 401. El reductor no implementa una promesa compartida ni coordina peticiones HTTP reales.

## 3. Caso A — Refresh exitoso

Cantidad de 401 simulados: 3
Eventos de refresh simulados: 1 (`refreshSucceeded`)
Identificadores registrados por el reductor: A, B y C

Resultado A: registrada en `retriedRequestIds` por el reductor
Resultado B: registrada en `retriedRequestIds` por el reductor
Resultado C: registrada en `retriedRequestIds` por el reductor

¿Mi predicción fue correcta?: Sí, para la secuencia de eventos simulada.

Explicación:
El test `src/course-evaluation/session-safety.test.ts` envía eventos `request401` para A, B y C y luego `refreshSucceeded` con `token-renovado-1`. `coordinateRefresh` devuelve `refreshCalls: 1`, `retriedRequestIds: ['A', 'B', 'C']`, `status: 'authenticated'` y el token modelado. Esto valida el reductor con esos eventos, no reintentos HTTP ejecutados ni concurrencia real.

## 4. Caso B — Refresh fallido

Mi predicción:
Cuando falla el refresh, la sesión se limpia, el estado vuelve a `anonymous`, se elimina el token persistido y no debe seguir intentando renovar la sesión indefinidamente.

¿Se eliminó la sesión?: Sí, en el modelo (`status: anonymous`, `persistedToken: null`).
¿Regresó al login?: No se puede determinar; el test no ejecuta navegación.
¿Hubo más de un refresh después del fallo?: No en la secuencia probada; contiene un solo evento `refreshFailed`.
¿Alguna petición quedó sin terminar?: No se puede determinar; el modelo no representa promesas ni peticiones pendientes.

Los tests `src/course-evaluation/session-safety.test.ts` y `src/course-evaluation/session-refresh-failure.test.ts` comprueban `refreshCalls: 1`, estado `anonymous`, `activeGeneration: null` y `persistedToken: null`. No se modela un `refreshToken` separado ni se comprueba almacenamiento real.

## 5. Mi decisión técnica

Elegí la opción C: `src/course-evaluation/index.ts` contiene un reductor de eventos de prueba, no un flujo de refresh HTTP conectado. El primer cambio sería integrarlo con el cliente HTTP y una fuente real de sesión. Si falla el refresh, esa integración debe limpiar los tokens persistidos y notificar a la navegación para volver al login. Una prueba de integración debe verificar que A, B y C terminen con error y que ninguna petición quede esperando.

## 6. Reflexión final

Si A y B obtienen tokens distintos y ambos actualizan el estado, una respuesta puede sobrescribir el token de la otra. Algunas peticiones podrían conservar un token inválido y fallar, o la sesión podría quedar inconsistente. Los tests de este proyecto no ejecutan dos refresh reales en paralelo; esta es la condición que una coordinación implementada en el cliente HTTP debería prevenir.

## Evidencia ejecutada

Se ejecutó desde la raíz del proyecto:

```bash
npm test -- --runInBand src/course-evaluation/session-safety.test.ts src/course-evaluation/session-refresh-failure.test.ts course-tests/public/week-06.test.ts
```

Resultado de ejecución:

```text
Test Suites: 3 passed, 3 total
Tests:       6 passed, 6 total
```

Incluye las dos suites locales de simulación y la suite pública de semana 6, que pasó sin modificaciones. Los logs de A/B/C y del fallo del refresh aparecen en la salida de `session-refresh-failure.test.ts`. Esta salida de Jest evidencia tests simulados, no una captura de ejecución de la app contra un backend.

Archivos de imagen guardados:

- `evidencia-caso-a.png`
- `evidencia-caso-b.png`
