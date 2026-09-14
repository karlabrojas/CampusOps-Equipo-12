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

La arquitectura seleccionada debe facilitar pruebas automatizadas, reducir el acoplamiento y permitir sustituir proveedores de datos sin modificar la lógica de negocio.

---

## Alternativas consideradas

## Alternativa A: Acoplamiento directo UI → Infraestructura

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
### Ventajas
- Menor cantidad de archivos.
- Curva de aprendizaje reducida.
- Implementación inicial más rápida.

### Desventajas
- La lógica de negocio queda mezclada con detalles técnicos.
- Las pruebas requieren dependencias concretas.
- Cambiar la fuente de datos implica modificar la UI.
- Mayor riesgo de regresiones.

### Testabilidad

**Baja.**

Las pruebas deben depender de implementaciones reales o simulaciones complejas.

### Complejidad

**Baja inicialmente.**

Alta a medida que aumenta el número de funcionalidades.

### Costo de cambiar proveedor

**Alto.**

Cambiar de memoria a HTTP, SQLite o cualquier otra fuente requiere modificar múltiples módulos consumidores.

## Alternativa B: Arquitectura por capas con Domain + Application + Infrastructure

### Descripción
Separar el dominio, los casos de uso y las implementaciones concretas.

```
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

### Ventajas
- Menor acoplamiento.
- Casos de uso independientes de la tecnología.
- Facilita pruebas unitarias.
- Permite sustituir implementaciones sin afectar la lógica de negocio.
- Favorece la mantenibilidad.

### Desventajas

- Más archivos y estructuras.
- Mayor esfuerzo inicial.
- Requiere comprender separación de responsabilidades.

### Testabilidad

**Alta.**

Los casos de uso pueden probarse utilizando repositorios simulados o implementaciones en memoria.

### Complejidad

**Moderada.**

La estructura inicial es más grande, pero el crecimiento del proyecto es más controlado.

### Costo de cambiar proveedor

**Bajo.**

Una implementación en memoria puede sustituirse por HTTP, SQLite o cualquier otra fuente de datos implementando el mismo contrato del dominio.

### Decisión

Se adopta la Alternativa B: Arquitectura por capas con Domain, Application e Infrastructure.

La decisión se basa en los siguientes factores:

- Mayor testabilidad de los casos de uso.
- Menor acoplamiento entre negocio y tecnología.
- Menor costo de reemplazo de proveedores de datos.
- Mejor mantenibilidad conforme aumenten las funcionalidades.

### Arquitectura implementada

Actualmente el proyecto se encuentra organizado de la siguiente forma:
```
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
-  Contrato IncidentRepository.

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

### Consecuencias

#### Beneficios

- Casos de uso fáciles de probar.
- Menor dependencia de tecnologías específicas.
- Cambio sencillo de proveedor de datos.
- Mayor claridad en responsabilidades.

#### Costos

- Incremento del número de archivos.
- Mayor complejidad inicial.
- Necesidad de mantener contratos y adaptadores.

#### Riesgos

- Crear capas innecesarias para funcionalidades muy pequeñas.
- Introducir complejidad si las responsabilidades no se respetan.

Estos riesgos se reducen manteniendo dependencias unidireccionales:

```
UI → Application → Domain
                  ↑
          Infrastructure
```

### Resultado esperado

Las futuras implementaciones de persistencia (HTTP, SQLite u otras) deberán reemplazar únicamente la capa Infrastructure sin modificar Domain ni Application.