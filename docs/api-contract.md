# CampusOps: contrato del cliente API

## Decisión técnica

El cliente HTTP de CampusOps será un adaptador de infraestructura que implementa el límite de repositorio de incidencias de la aplicación. Las pantallas y los casos de uso no conocerán rutas, encabezados, `fetch`, códigos HTTP ni DTO remotos. El adaptador traduce comandos del dominio a solicitudes, valida las respuestas y proyecta los DTO a los tipos internos antes de devolverlos.

La implementación se ubicará junto al cliente existente en `src/api/`: el transporte centraliza URL base, serialización, lectura de respuestas y errores; el cliente de incidencias expone operaciones tipadas y satisface `IncidentRepository` de `src/campusops/contracts.ts`. No se duplicará la lógica de negocio en el cliente ni se crearán modelos de aplicación a partir de una conversión directa con `as`.

### Alternativas consideradas

| Alternativa | Ventaja | Costo o riesgo |
|---|---|---|
| HTTP desde pantallas o casos de uso | Menos piezas iniciales | Acopla UI y negocio al protocolo, duplica manejo de errores y dificulta pruebas sin red. |
| Usar el DTO remoto directamente como entidad de aplicación | Menos mapeo | Filtra detalles del backend al dominio, hace frágil la app ante cambios del contrato y no valida datos de dominio. |
| Adaptador API/repositorio con DTO y mapeo explícitos (elegida) | Aísla el protocolo, concentra validación y permite probar aplicación y transporte por separado | Mantiene tipos DTO y mapeadores adicionales que deben evolucionar con el contrato. |

Se elige el adaptador porque el proyecto ya define `IncidentRepository` y casos de uso independientes del transporte. Además, `parseRemoteResource` proporciona el primer control común del sobre remoto sin convertirlo en una validación ficticia del payload.

## Frontera de datos

Los DTO remotos representan exactamente el contrato del backend didáctico. No son instancias de `Incident` ni deben propagarse a la UI. La respuesta HTTP se trata como `unknown` hasta validar el JSON y cada recurso. Para cada incidencia se ejecuta `parseRemoteResource(dto)`; si devuelve error, la operación falla como respuesta incompatible. Si acepta `payload: null`, el sobre es válido, pero el recurso no puede convertirse a una incidencia y debe rechazarse como dato de dominio inválido, nunca completarse con valores inventados.

El mapeador valida también los campos requeridos por la app: `category` debe pertenecer a las categorías conocidas, `description`, `location` y `reporterId` deben ser texto no vacío, `assignedTechnicianId` debe ser texto no vacío o `null`, y `status` debe ser uno de los estados declarados. `id`, `version` y `status` se obtienen del sobre validado. El cliente ignora campos adicionales que el dominio no use, de modo que una extensión remota no se filtre automáticamente a la aplicación.

| DTO remoto | Modelo de aplicación | Regla de conversión |
|---|---|---|
| `id`, `version`, `status` del sobre | `Incident.id`, `version`, `work.status` | Usar sólo tras validar el sobre con `parseRemoteResource`; validar `status` contra el conjunto del dominio. |
| `payload.reporterId` | `Incident.reporterId` | Identificador sintético no vacío; no es nombre ni perfil de usuario. |
| `payload.category`, `payload.description` | `Incident.category`, `description` | Validar tipos y categoría del dominio. |
| `payload.location` (texto) | `Incident.location` | Adaptar a `{ source: 'manual', label }`; el API actual no entrega coordenadas ni fuente de geocodificación. |
| `payload.assignedTechnicianId` | `Incident.work.assignedTechnicianId` | Texto no vacío o `null`. |
| `status` y `assignedTechnicianId` | `Incident.work` | El estado está en el sobre remoto, pero dentro del dominio forma parte de `work`. |
| `priority`, `notes`, `evidence`, `history` y otros campos remotos | Sin campo en el `Incident` actual | No incorporarlos silenciosamente; su modelado requiere una decisión de dominio separada. |

La conversión de ubicación preserva únicamente la etiqueta que permite el contrato actual. En el modelo actual, `source: 'manual'` funciona como marcador de ubicación textual sin procedencia disponible en el DTO, no como afirmación de que el usuario la escribió. No se deben fabricar latitud/longitud ni afirmar que la ubicación provino del proveedor. Si el dominio llegara a requerir una conversión de origen exacta, habría que ampliar coordinadamente el contrato backend y el mapeador.

## Solicitudes y respuestas

Base local por defecto: `http://127.0.0.1:4310`. Para emulador Android se usa `http://10.0.2.2:4310`; cualquier URL configurable se limita a redes de laboratorio. El simulador sólo usa identidades y credenciales sintéticas y no ofrece autenticación de producción. El backend valida `Authorization: Bearer course-valid-token` y `X-Course-Actor`; la app obtiene esos valores del estado de sesión del entorno didáctico, no los codifica en pantallas ni confía en el rol para autorizar operaciones.

Las solicitudes CampusOps autenticadas llevan `Accept: application/json`, `Authorization` y `X-Course-Actor`. Los POST llevan además `Content-Type: application/json` y una clave `Idempotency-Key` estable de al menos 8 caracteres. Los valores concretos de fixtures se reservan para pruebas y no son secretos ni identidades reales.

### Listar incidencias

`GET /v1/incidents` devuelve las incidencias visibles al actor: las propias para reportantes, las asignadas para técnicos y todas para coordinación.

```json
{
	"items": [
		{
			"id": "campus-inc-001",
			"version": 1,
			"status": "assigned",
			"payload": {
				"category": "connectivity",
				"description": "Sin conexión en laboratorio ficticio",
				"location": "Edificio de prueba A",
				"reporterId": "reporter-1",
				"assignedTechnicianId": "technician-1",
				"priority": "medium",
				"notes": [],
				"evidence": [],
				"history": []
			}
		}
	]
}
```

Validar primero que la respuesta sea un objeto con `items` como arreglo. Pasar cada elemento por `parseRemoteResource` y luego por el validador/mapeador de dominio. Si un elemento no es válido, fallar la lectura completa con error de contrato; no devolver una lista parcial que oculte corrupción del backend.

### Obtener detalle

`GET /v1/incidents/:id` devuelve un DTO de recurso con el mismo sobre `{ id, version, status, payload }`, sin envoltura `items`. Se valida con `parseRemoteResource` y el mapeador de dominio antes de entregarlo al caso de uso. Una incidencia inexistente responde `404`; una incidencia existente pero no visible para el actor responde `403`.

### Crear incidencia

`POST /v1/incidents` es una operación de reportante. El cuerpo acepta una categoría del contrato, una descripción no vacía y una ubicación textual no vacía. El cliente genera una clave de idempotencia por operación y la conserva sin cambios al reintentar; no debe crear una nueva clave tras un timeout ambiguo.

```http
POST /v1/incidents
Authorization: Bearer course-valid-token
X-Course-Actor: reporter-1
Idempotency-Key: create-incident-0001
Content-Type: application/json
```

```json
{
	"category": "connectivity",
	"description": "Sin conexión en laboratorio ficticio",
	"location": "Edificio de prueba A"
}
```

La creación normal responde `201` con `{ "incident": <DTO>, "operationId": <clave>, "duplicate": false }`. Un replay idéntico puede responder `200` con el mismo resultado y `duplicate: true`. Validar la envoltura y pasar `incident` por `parseRemoteResource` y el mapeador de dominio antes de devolverlo. El cliente sólo proyecta a la aplicación los campos que ésta modela; el DTO completo no sale del adaptador.

## Errores y resiliencia

El cliente entrega errores tipados al llamador, diferenciando al menos: `network`/timeout (no se recibió una respuesta fiable), `http` (respuesta no exitosa con estado y código remoto conocido), `contract` (JSON ilegible o forma incompatible) y `domain` (sobre válido cuyo payload no representa una incidencia válida). El código de error remoto puede ser opcional; no se usa texto arbitrario del servidor como mensaje visible. `Retry-After` se conserva como metadato para el caso `429` cuando sea válido.

| Respuesta | Interpretación de aplicación |
|---|---|
| `400` / `422` | Solicitud o validación rechazada; mostrar error recuperable de entrada/operación. |
| `401` | Sesión no autorizada; delegar al flujo de sesión, no reintentar en bucle. |
| `403` | Actor sin permiso o incidencia no visible; no asumir que ocultar controles en UI basta. |
| `404` | Recurso inexistente; en lista es anómalo sólo si el contrato lo indica, en detalle/creación referenciada es not-found. |
| `409` | Conflicto de versión o de idempotencia; conservar intención y no repetir con otra clave para forzar éxito. |
| `429` | Límite temporal; considerar `Retry-After` y reintentar sólo según política acotada. |
| `5xx`, timeout o desconexión | Resultado incierto para escrituras; conservar la clave y repetir exactamente solicitud y contenido. |
| JSON o DTO inválido | Error de contrato; no pasar la respuesta al dominio ni fabricar valores por defecto. |

Una respuesta perdida tras el commit no demuestra que la creación falló. El replay con la misma clave y el mismo contenido permite al backend devolver el resultado anterior sin duplicar incidencias. Reutilizar una clave con contenido distinto es un conflicto.

## Privacidad y observabilidad

No registrar encabezados de autorización, tokens, datos personales, ubicación, descripción libre, notas, evidencias ni respuestas completas. Los logs técnicos se limitan a operación, código HTTP/código de error permitido, intento, duración e identificador sintético de correlación. Antes de enviar estructuras a telemetría se aplica `redactForTelemetry`; no se interpreta esa redacción como autorización para registrar texto libre. Los errores expuestos a UI omiten tokens y payloads remotos.

## Implementación y verificación

`src/api/campusOpsClient.ts` implementa el adaptador de `IncidentRepository` y las operaciones de lista, detalle y creación. `src/api/courseBackend.ts` centraliza el transporte JSON y los errores de red/HTTP. `src/course-evaluation/index.ts` implementa la validación estructural del sobre remoto. Las pruebas del cliente usan un transporte sustituible, sin red pública.

La suite `src/api/campusOpsClient.test.ts` comprueba los tres flujos normales, DTO incompatibles, `payload: null`, `404` en detalle, `429` con `Retry-After`, fallo de red, ausencia de sesión y repetición de una creación conservando la clave generada. `course-tests/public/week-05.test.ts` verifica los casos publicados de `parseRemoteResource`. El cliente no emite logs ni expone cuerpos de error arbitrarios; la sanitización general de telemetría sigue disponible mediante `redactForTelemetry`.

Queda pendiente inyectar el cliente en flujos autenticados de pantalla: actualmente `App.tsx` sólo consulta `/health` y el proyecto aún no tiene una pantalla de incidencias ni estado de sesión CampusOps. Cuando esos flujos existan, el punto de composición debe entregar `CampusOpsClient` a los casos de uso; las pantallas no deben invocar HTTP directamente. La cobertura automatizada actual no sustituye una prueba de integración contra el proceso real del backend ni cubre individualmente cada código HTTP posible.

## Referencias del proyecto

- `docs/CAMPUSOPS_API.md`: contrato público de integración, actores y escenarios.
- `course-backend/README.md` y `course-backend/campusops.mjs`: backend didáctico y formato real de solicitudes/respuestas.
- `src/campusops/contracts.ts`: modelo interno y puerto `IncidentRepository`.
- `src/api/courseBackend.ts`: cliente HTTP existente para salud del backend.
- `src/course-evaluation/index.ts`: implementación de `parseRemoteResource` y sanitización de telemetría.
