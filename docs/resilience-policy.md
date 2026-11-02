# Política de resiliencia — CampusOps

## 1. Objetivo

Definir la política de reintentos para las solicitudes HTTP de CampusOps, evitando reintentos ilimitados, respetando las indicaciones del servidor y protegiendo las operaciones de escritura contra duplicados.

Esta política corresponde a la Semana 9 — Resiliencia y ubicación manual.

## 2. Límites de reintentos

La función `planRetry` determina si una solicitud puede reintentarse.

- Los intentos deben ser enteros y comenzar desde 1.
- Se permiten reintentos únicamente antes del intento 4.
- A partir del intento 4 no se programa otro reintento.
- Los errores no recuperables no deben reintentarse.

Se consideran recuperables:

- Timeout.
- HTTP 408.
- HTTP 429.
- Errores HTTP del rango 500–599.

Los errores HTTP como 403 y 404 no generan reintentos.

## 3. Estrategia de backoff

Cuando no existe un valor válido de `Retry-After`, se utiliza backoff exponencial:

| Intento | Demora |
|---|---:|
| 1 | 500 ms |
| 2 | 1000 ms |
| 3 | 2000 ms |
| 4 o superior | Sin reintento |

La demora se limita a 2000 ms para los intentos contemplados por esta política.

## 4. Tratamiento de Retry-After

Cuando el servidor proporciona `Retry-After` mediante un valor válido, la política utiliza ese tiempo como demora del siguiente intento.

Se considera válido un valor numérico finito mayor o igual a cero.

Cuando el valor está ausente o no es válido, se utiliza el backoff exponencial.

El adaptador HTTP interpreta la cabecera `Retry-After` y expone el resultado mediante `retryAfterMs`.

## 5. Idempotencia en operaciones POST

Las operaciones POST requieren una identidad estable para permitir un reintento.

La función `planRetry` rechaza el reintento de un POST cuando no se proporciona una clave de idempotencia no vacía.

CampusOps utiliza `Idempotency-Key` para identificar la operación.

Cuando una creación de incidencia termina con una respuesta incierta, el cliente conserva el `operationId` original para repetir exactamente la misma operación.

Esto permite que el servidor reconozca la operación repetida y evite duplicar el historial.

## 6. Respuesta perdida después de guardar

El escenario `timeout_after_commit` representa una situación en la que el servidor guarda la operación, pero el cliente no recibe la respuesta debido a un timeout o desconexión.

La recuperación debe repetir la operación utilizando la misma clave de idempotencia.

La prueba automatizada del cliente verifica que la primera solicitud y el reintento utilicen la misma clave, y que el servidor pueda responder indicando que la operación ya fue procesada.

## 7. Verificación automatizada

La implementación se verifica mediante pruebas para:

- Backoff exponencial de 500, 1000 y 2000 ms.
- Límite de reintentos antes del intento 4.
- Uso de un valor válido de `Retry-After`.
- Uso de backoff cuando `Retry-After` es inválido.
- Rechazo de POST sin clave de idempotencia.
- Permiso de reintento POST con clave estable.
- Exclusión de errores HTTP no recuperables.
- Rechazo de números de intento inválidos.
- Conservación de la clave ante una respuesta incierta.

## 8. Consideraciones de implementación

`planRetry` es una función de política que determina si corresponde reintentar y cuánto esperar.

La decisión de ejecutar el reintento corresponde al flujo que consume esta política. La existencia de esta función no implica por sí sola que todas las solicitudes se reintenten automáticamente.

Las mediciones de intentos y tiempos, así como los resultados de inyección de fallos, deben registrarse a partir de ejecuciones verificables en los reportes de la Semana 9.
