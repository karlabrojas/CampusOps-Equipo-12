# ADR-001: Arquitectura de CampusOps

## Estado

Aceptado

## Contexto

CampusOps es una aplicación para el registro y seguimiento de incidencias dentro de un campus académico ficticio.

Durante la segunda semana del proyecto se requiere implementar la funcionalidad de consulta de incidencias mediante:

- Modelo de dominio Incident.
- Casos de uso para listar incidencias.
- Casos de uso para obtener una incidencia por identificador.
- Un repositorio de incidencias desacoplado de la fuente de datos.
- Una implementación temporal en memoria para pruebas y desarrollo.

CampusOps necesita mantener una pantalla de incidencias con una lista y un detalle, pero también debe conservar separadas las responsabilidades de UI, aplicación, dominio e infraestructura. La UI no debe depender de detalles de implementación ni de librerías de acceso a datos. La aplicación debe describir las reglas del caso de uso y dejar la persistencia a un adaptador concreto.

La arquitectura seleccionada debe facilitar pruebas automatizadas, reducir el acoplamiento y permitir sustituir proveedores de datos sin modificar la lógica de negocio.

## Alternativas consideradas

### Alternativa A: Acoplamiento directo UI → Infraestructura

#### Descripción

La interfaz de usuario accede directamente a la implementación concreta del repositorio o a llamadas HTTP.

Ejemplo:

```text
App.tsx

   │

   ▼

InMemoryIncidentRepository
```

O:

```text
App.tsx

   │

   ▼

HTTP / API
```

La pantalla de incidencias accede directamente al repositorio en memoria desde la vista. La lógica de listado y los detalles del almacenamiento están mezclados con la presentación.

#### Ventajas

- Menor cantidad de archivos.
- Curva de aprendizaje reducida.
- Implementación inicial más rápida.
- es la forma más simple de empezar;
- requiere menos archivos;
- permite mostrar datos rápido.

#### Desventajas

- La lógica de negocio queda mezclada con detalles técnicos.
- Las pruebas requieren dependencias concretas.
- Cambiar la fuente de datos implica modificar la UI.
- Mayor riesgo de regresiones.
- la interfaz depende de la implementación concreta;
- es más difícil probar reglas de negocio aisladas;
- cambiar la fuente de datos requiere editar la pantalla;
- la arquitectura no queda explicita para equipos o cambios futuros.

#### Testabilidad

**Baja.**

Las pruebas deben depender de implementaciones reales o simulaciones complejas.

#### Complejidad

**Baja inicialmente.**

Alta a medida que aumenta el número de funcionalidades.

#### Costo de cambiar proveedor

**Alto.**

Cambiar de memoria a HTTP, SQLite o cualquier otra fuente requiere modificar múltiples módulos consumidores.

### Alternativa B: Arquitectura por capas con Domain + Application + Infrastructure

#### Descripción

Separar el dominio, los casos de uso y las implementaciones concretas.

```text
UI

│

▼

Application

│

▼

Domain (contratos)

│

▼

Infrastructure
```

La capa Domain define únicamente las reglas y contratos.

La capa Application implementa los casos de uso.

La capa Infrastructure proporciona implementaciones concretas de los contratos.

La pantalla usa un caso de uso, el caso de uso usa un repositorio definido por interfaz del dominio, y la infraestructura implementa esa interfaz con datos ficticios o un backend real.

#### Ventajas

- Menor acoplamiento.
- Casos de uso independientes de la tecnología.
- Facilita pruebas unitarias.
- Permite sustituir implementaciones sin afectar la lógica de negocio.
- Favorece la mantenibilidad.
- la UI queda centrada en renderizado y entradas del usuario;
- el caso de uso encapsula la regla de ordenar y devolver incidencias;
- el dominio define el modelo clave y el contrato de persistencia;
- cambiar el proveedor es local y controlado;
- facilita pruebas y evoluciones del sistema.

#### Desventajas

- Más archivos y estructuras.
- Mayor esfuerzo inicial.
- Requiere comprender separación de responsabilidades.
- requiere más archivos y más abstracciones;
- exige mantener la inyección de dependencias;
- hay un costo inicial de diseño.

#### Testabilidad

**Alta.**

Los casos de uso pueden probarse utilizando repositorios simulados o implementaciones en memoria.

#### Complejidad

**Moderada.**

La estructura inicial es más grande, pero el crecimiento del proyecto es más controlado.

#### Costo de cambiar proveedor

**Bajo.**

Una implementación en memoria puede sustituirse por HTTP, SQLite o cualquier otra fuente de datos implementando el mismo contrato del dominio.

## Decisión

Se adopta la Alternativa B: Arquitectura por capas con Domain, Application e Infrastructure.

Se adopta la segunda alternativa: UI, Application, Domain e Infrastructure separadas con dependencias dirigidas.

La decisión se basa en los siguientes factores:

- Mayor testabilidad de los casos de uso.
- Menor acoplamiento entre negocio y tecnología.
- Menor costo de reemplazo de proveedores de datos.
- Mejor mantenibilidad conforme aumenten las funcionalidades.

El flujo queda así:

- UI usa los casos de uso para pedir incidencias;
- Application usa el contrato del repositorio del dominio;
- Domain define `Incident` y `IncidentRepository`;
- Infrastructure implementa la interfaz con `InMemoryIncidentRepository`.

## Arquitectura implementada

Actualmente el proyecto se encuentra organizado de la siguiente forma:

```text
src/

├── api/
│   └── courseBackend.ts
│
├── campusops/
│   ├── application/
│   │   ├── getIncident.ts
│   │   └── listIncidents.ts
│   │
│   ├── domain/
│   │   ├── Incident.ts
│   │   └── IncidentRepository.ts
│   │
│   └── infrastructure/
│       └── inMemoryIncidentRepository.ts
```

### Responsabilidades

**Domain**

Contiene:

- Entidad Incident.
- Contrato IncidentRepository.

No depende de UI, HTTP, Expo ni almacenamiento.

**Application**

Contiene:

- listIncidents
- getIncident

Implementa casos de uso utilizando únicamente contratos definidos en Domain.

**Infrastructure**

Contiene:

- inMemoryIncidentRepository

Implementación concreta utilizada para desarrollo y pruebas.

**UI**

Consume los casos de uso definidos en Application.

## Consecuencias

### Beneficios

- Casos de uso fáciles de probar.
- Menor dependencia de tecnologías específicas.
- Cambio sencillo de proveedor de datos.
- Mayor claridad en responsabilidades.
- La vista no conoce detalles de persistencia.
- El caso de uso es reutilizable y fácil de probar.
- El dominio permanece estable incluso si cambia la fuente de datos.
- La inversión inicial es aceptable y el proyecto queda preparado para un backend real.

### Costos y trade-off

- Incremento del número de archivos.
- Mayor complejidad inicial.
- Necesidad de mantener contratos y adaptadores.
- Hay más archivos y más código de infraestructura.
- Hay que mantener el contenedor de inyección de dependencias.
- Un cambio de proveedor requiere ajustar la implementación concreta, no la lógica del caso de uso.

### Riesgos

- Crear capas innecesarias para funcionalidades muy pequeñas.
- Introducir complejidad si las responsabilidades no se respetan.

Estos riesgos se reducen manteniendo dependencias unidireccionales:

```text
UI → Application → Domain
                    ↑
              Infrastructure
```

## Resultado esperado

Las futuras implementaciones de persistencia (HTTP, SQLite u otras) deberán reemplazar únicamente la capa Infrastructure sin modificar Domain ni Application.

## Relación con la evidencia

La comprobación actual confirma que la UI no depende directamente del repositorio de infraestructura y que el flujo principal funciona con la prueba `npm run test:smoke`, además de que TypeScript compila sin errores.
