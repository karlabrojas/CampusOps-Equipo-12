# ADR-001: separación por capas para CampusOps

- Estado: aceptada
- Fecha: 2026-09-12

## Contexto

CampusOps necesita mantener una pantalla de incidencias con una lista y un detalle, pero también debe conservar separadas las responsabilidades de UI, aplicación, dominio e infraestructura. La UI no debe depender de detalles de implementación ni de librerías de acceso a datos. La aplicación debe describir las reglas del caso de uso y dejar la persistencia a un adaptador concreto.

## Alternativas consideradas

### Alternativa 1: UI directa con repositorio y datos de prueba

La pantalla de incidencias accede directamente al repositorio en memoria desde la vista. La lógica de listado y los detalles del almacenamiento están mezclados con la presentación.

Ventajas:
- es la forma más simple de empezar;
- requiere menos archivos;
- permite mostrar datos rápido.

Desventajas:
- la interfaz depende de la implementación concreta;
- es más difícil probar reglas de negocio aisladas;
- cambiar la fuente de datos requiere editar la pantalla;
- la arquitectura no queda explicita para equipos o cambios futuros.

### Alternativa 2: separación de capas con contrato de dominio

La pantalla usa un caso de uso, el caso de uso usa un repositorio definido por interfaz del dominio, y la infraestructura implementa esa interfaz con datos ficticios o un backend real.

Ventajas:
- la UI queda centrada en renderizado y entradas del usuario;
- el caso de uso encapsula la regla de ordenar y devolver incidencias;
- el dominio define el modelo clave y el contrato de persistencia;
- cambiar el proveedor es local y controlado;
- facilita pruebas y evoluciones del sistema.

Desventajas:
- requiere más archivos y más abstracciones;
- exige mantener la inyección de dependencias;
- hay un costo inicial de diseño.

## Decisión

Se adopta la segunda alternativa: UI, application, domain e infrastructure separadas con dependencias dirigidas. El flujo queda así:

- UI usa el caso de uso para pedir incidencias;
- application usa el contrato del repositorio del dominio;
- domain define `Incidencia` y `IncidenciasRepository`;
- infrastructure implementa la interfaz con `InMemoryIncidenciasRepository`.

## Consecuencias

### Beneficios

- La vista no conoce detalles de persistencia.
- El caso de uso es reutilizable y fácil de probar.
- El dominio permanece estable incluso si cambia la fuente de datos.
- La inversión inicial es aceptable y el proyecto queda preparado para un backend real.

### Costes y trade-off

- Hay más archivos y más código de infraestructura.
- Hay que mantener el contenedor de inyección de dependencias.
- Un cambio de proveedor requiere ajustar la implementación concreta, no la lógica del caso de uso.

## Relación con la evidencia

La comprobación actual confirma que la UI no depende directamente del repositorio de infraestructura y que el flujo principal funciona con la prueba `npm run test:smoke`, además de que TypeScript compila sin errores.
