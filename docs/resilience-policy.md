# Resiliencia de geocodificación y selección de ubicación

## Alcance y estado

Este documento define la política para buscar una ubicación de incidencia y permitir captura manual cuando la búsqueda no esté disponible. La UI y los casos de uso dependerán de un adaptador de ubicación, no de un proveedor HTTP concreto.

Implementación actual:

- `selectIncidentLocation` valida la respuesta y cae a una etiqueta manual sin coordenadas si el resultado externo es nulo, incompleto o inválido.
- `planRetry` limita los intentos a tres, aplica backoff exponencial y sólo permite repetir POST con una clave idempotente. Rechaza programar un retry que excedería el máximo local de 60 segundos en vez de ignorar un `Retry-After` mayor.
- `NominatimGeocodingProvider` implementa el adaptador HTTP en `src/campusops/infrastructure/geocodingProvider.ts`; `IncidentLocationService` administra validación, caché y fallback manual.
- `SqliteLocationCache` persiste resultados verificados en la tabla `geocoding_cache`, añadida por la migración de esquema v3.
- `docs/CAMPUSOPS_API.md` define la función pura de selección y el contrato del doble didáctico.
- `GET /v1/geocoding` en `course-backend/campusops.mjs` es un doble determinista; no consulta datos reales ni acredita una integración externa.

El adaptador Nominatim requiere configurar explícitamente un endpoint HTTPS y un `User-Agent` de aplicación; no se llama automáticamente desde la UI. La política no declara una ejecución externa real: las pruebas usan dobles controlados. La integración con una pantalla de creación de incidencias y la evidencia externa siguen pendientes.

## Decisión de proveedor y límites

Se propone OpenStreetMap Nominatim como proveedor inicial para una integración académica de bajo volumen, detrás de un adaptador reemplazable. La instancia pública `nominatim.openstreetmap.org` sólo se podrá usar si el equipo responsable confirma que el volumen, el uso y las condiciones vigentes son apropiados. No es un servicio de producción garantizado.

La [política de uso de Nominatim](https://operations.osmfoundation.org/policies/nominatim/) establece, entre otros requisitos:

- Máximo absoluto de una solicitud por segundo para la instancia pública; la política aplica al tráfico agregado de la aplicación.
- Identificar la aplicación con un `User-Agent` o `Referer` válido, mostrar atribución de OpenStreetMap y cumplir la licencia ODbL.
- Consultas de búsqueda iniciadas directamente por el usuario; no usar autocomplete, solicitudes periódicas, búsquedas sistemáticas ni procesamiento masivo.
- Enviar sólo la información mínima necesaria; no enviar datos personales o confidenciales.
- Mantener caché y poder cambiar de servicio si se solicita. Un proxy propio facilita identificar la app, limitar el tráfico y cambiar proveedor sin publicar una nueva versión.

El adaptador limita sus propias solicitudes a una por segundo por instancia. Ese límite local no puede garantizar el máximo agregado entre varios dispositivos. La recomendación es que el adaptador de infraestructura use un endpoint controlado por el equipo (proxy/backend) para concentrar identificación, límite de frecuencia y configuración del proveedor. El proxy no debe ser un mecanismo para evadir límites. Si no existe un proxy operativo autorizado, no se debe llamar desde producción a la instancia pública sin confirmar que la app nativa puede cumplir sus requisitos de identificación y frecuencia. Para más usuarios, disponibilidad contractual o necesidades de producción, se debe elegir un proveedor comercial o una instancia propia y documentar sus términos, cuotas, atribución, privacidad y credenciales antes de activarlo.

No se agregan SDKs ni dependencias nativas de mapas: el stack existente es Expo, React Native y TypeScript, y la búsqueda geográfica puede encapsularse con el transporte HTTP existente. Esta decisión no incorpora un mapa interactivo, navegación ni seguimiento de ubicación.

## Fronteras y contrato

La integración se divide en tres responsabilidades:

1. **`NominatimGeocodingProvider` (adaptador):** recibe una consulta explícita y devuelve datos normalizados como `unknown`. Traduce timeout, falta de red, HTTP 429, otras fallas HTTP y JSON inválido a `GeocodingProviderError`; las cadenas de latitud/longitud del contrato Nominatim se convierten explícitamente en números antes de la validación del dominio.
2. **`SqliteLocationCache` (puerto local):** guarda y recupera sólo resultados del proveedor que pasaron validación estricta. Está implementada sobre SQLite y esquema v3; revalida TTL y formato en cada lectura.
3. **`selectIncidentLocation(providerResult, manualLabel)`:** conserva exactamente el contrato público de `docs/CAMPUSOPS_API.md`. La función recibe el resultado externo, ya sea válido o no, y un texto manual no vacío. Devuelve una ubicación `source: 'provider'` con etiqueta y coordenadas válidas, o `source: 'manual'` únicamente con la etiqueta manual. La UI puede mostrar el estado de caché por separado, sin alterar este contrato.

El DTO de incidencia del backend actual sólo transporta `location` como texto. El mapeo existente en `docs/api-contract.md` no permite afirmar que el servidor conserve coordenadas o la procedencia de geocodificación. No se deben cambiar ni inferir esos datos en este límite; una ampliación requeriría modificar coordinadamente los contratos, el modelo y el backend.

### Validación de una respuesta

Una respuesta sólo es utilizable si es un objeto con:

- `label`: cadena cuyo contenido, tras quitar espacios al inicio y final, no queda vacío.
- `latitude`: número finito en el intervalo cerrado `[-90, 90]`.
- `longitude`: número finito en el intervalo cerrado `[-180, 180]`.

Se rechazan `null`, errores representados como datos, respuesta mal formada, campos ausentes, tipos incorrectos, `NaN`, infinitos y coordenadas fuera de rango. Las coordenadas `0` son numéricamente válidas; sólo se aceptan como resultado de una respuesta válida del proveedor o de una entrada cacheada originalmente de ese proveedor, nunca como valor por defecto.

Si el resultado no pasa la validación, se ofrece la captura manual. No se combinan la etiqueta de una respuesta inválida con coordenadas de otra fuente ni se convierten cadenas numéricas en coordenadas implícitamente.

## Política de caché

La caché evita consultas repetidas, permite una recuperación limitada sin red y nunca hace pasar información caducada o inválida por un resultado fresco.

### Clave y contenido

- La clave se deriva de la consulta con espacios iniciales/finales eliminados y espacios internos colapsados, idioma/región si se envían, y un identificador/versión del proveedor. Se conserva el uso de mayúsculas para no conflar consultas distintas; los parámetros que cambien el resultado deben formar parte de la clave.
- Se guarda únicamente una respuesta completa y validada: etiqueta, latitud, longitud, instante de recepción y metadatos mínimos del proveedor.
- No se guardan respuestas mal formadas, vacías, errores HTTP, timeout, 429, fallas de red ni ubicaciones manuales como resultados del proveedor.
- Los datos se almacenan localmente en el espacio privado de la aplicación. No se registran la consulta, la etiqueta ni las coordenadas en logs o telemetría.

### Vigencia y uso

- TTL propuesto: 30 días desde una respuesta válida. La vigencia se calcula con el reloj actual frente a `fetchedAt`; una entrada expirada no se devuelve como resultado válido.
- Con conexión, se puede usar una entrada vigente para la misma clave y evitar una llamada; la UI debe indicar que se reutilizó un resultado guardado cuando el contexto lo requiera.
- Sin conexión, se puede reutilizar únicamente una entrada vigente y validada. Si no existe, expiró o no pasa una nueva comprobación de formato/rango, se solicita una ubicación manual.
- No se usa fallback stale-while-revalidate ni se prolonga la vigencia por indisponibilidad. La ubicación manual tampoco recibe coordenadas heredadas de una entrada expirada.
- Un cambio de proveedor o de versión de formato no debe reinterpretar entradas antiguas como nuevas: la versión forma parte de la clave, y la migración/limpieza debe conservar sólo datos todavía válidos.

El TTL de 30 días es una política local propuesta para este ejercicio, no una garantía de vigencia del proveedor. Debe revisarse con el integrante responsable de la resiliencia y ajustarse si el proveedor elegido o sus términos requieren otra retención.

## Timeout, errores y recuperación

- Las consultas son explícitas, iniciadas por la persona usuaria. No se activa geocodificación en segundo plano ni autocomplete.
- El adaptador cancela la solicitud con `AbortController` al alcanzar un timeout local acotado y expone un resultado `timeout`; `IncidentLocationService.select` devuelve la alternativa manual ante los errores tipados, mientras que la futura UI debe mantener disponible la entrada manual durante la carga y al fallar.
- Desconexión/timeout, respuesta no exitosa y error de contrato se distinguen internamente para diagnóstico, pero todos permiten continuar con la ubicación manual.
- Ante `429`, se interpreta `Retry-After` si es válido y se expone como `retryAfterMs`. No se repite de inmediato; se informa que el servicio está limitado y se ofrece esperar o capturar manualmente. `planRetry` no programa un reintento si el tiempo excede 60 segundos; no se bloquea el flujo esperando el proveedor.
- Otros errores `5xx` o de red no provocan reintentos ilimitados. No se confunde timeout con confirmación de una ubicación ni se crea una entrada de caché negativa.
- La UI muestra claramente carga, resultado, uso de caché, indisponibilidad y edición manual. Debe permitir cancelar o cambiar a manual sin perder el texto ya escrito.
- Si el usuario deniega o cancela permisos de ubicación del dispositivo, la búsqueda por texto y la captura manual siguen disponibles; no se solicita ubicación en segundo plano.

## Pruebas y evidencia

La suite automatizada debe usar un doble inyectable y un reloj controlable, sin depender de cuotas o de disponibilidad externa. Debe cubrir:

1. Respuesta válida y coordenadas límite válidas.
2. `null`, etiqueta vacía, campos ausentes, tipo incorrecto, `NaN`, infinitos y latitud/longitud fuera de rango; cada caso debe terminar en ubicación manual sin coordenadas.
3. Timeout, HTTP 429 con y sin `Retry-After`, respuesta `5xx` y desconexión; la aplicación debe seguir permitiendo captura manual.
4. Caché: guardar sólo resultados válidos, reutilizar antes del TTL, rechazar al expirar, aislar por proveedor/idioma y permitir fallback offline sólo con una entrada vigente.
5. Reintento limitado y ninguna llamada duplicada por renders o búsquedas no confirmadas por el usuario.
6. La ausencia de datos válidos no produce coordenadas por defecto.

Las pruebas unitarias de `src/campusops/infrastructure/geocodingProvider.test.ts` y `locationService.test.ts` usan fetchers y caché en memoria controlables para éxito, respuesta inválida, timeout, 429 y desconexión. `localSyncStore.test.ts` prueba persistencia, expiración y rollback de la migración v3 usando SQLite.js. `course-tests/public/week-09.test.ts` valida el contrato de reintentos y fallback manual.

El backend didáctico permite probar respuestas `incomplete`, `invalid_coordinates`, `rate_limited`, `server_error` y `slow` mediante `X-Course-Scenario`; `npm run backend:self-test` valida sus contratos. Ese backend es un doble, no una llamada a Nominatim. La suite local no sustituye la evidencia de una ejecución externa real.

Ejecución reproducible verificada para esta implementación:

```text
npm test -- --runInBand src/course-evaluation/locationSelection.test.ts src/campusops/infrastructure/locationService.test.ts src/campusops/infrastructure/geocodingProvider.test.ts src/campusops/infrastructure/localSyncStore.test.ts course-tests/public/week-09.test.ts
5 suites, 50 pruebas aprobadas
npm run typecheck
PASS
npm run backend:self-test
Controlled backend self-test passed.
```

La suite usa dobles locales y no hace solicitudes a Internet. La evidencia externa requerida debe generarse sólo después de ejecutar realmente el adaptador contra el proveedor seleccionado, con una consulta ficticia y no sensible. Debe registrar fecha, proveedor/endpoint, comando o flujo reproducible, resultado resumido y atribución aplicable, sin guardar tokens, consultas identificables ni coordenadas innecesarias. Una corrida contra el doble local se documenta como prueba simulada, nunca como evidencia del proveedor externo. No se ejecutó ni se declara una consulta externa real.

## Referencias del proyecto

- Contrato de integración y `selectIncidentLocation`: [`CAMPUSOPS_API.md`](./CAMPUSOPS_API.md).
- Alcance, privacidad y alternativa manual: [`CAMPUSOPS.md`](./CAMPUSOPS.md).
- Adaptación de ubicación textual del DTO: [`api-contract.md`](./api-contract.md).
- Política oficial de Nominatim: https://operations.osmfoundation.org/policies/nominatim/.
- API de búsqueda de Nominatim: https://nominatim.org/release-docs/latest/api/Search/.
