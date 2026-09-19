# CampusOps — Modelo de amenazas inicial

## 1. Objetivo

Este documento identifica los principales activos, fronteras de confianza y amenazas de seguridad relevantes para CampusOps. También relaciona cada amenaza priorizada con un control y una comprobación verificable para la Semana 03.

El modelo se basa en la arquitectura definida durante la Semana 02:

```text
UI
 ↓
Application
 ↓
Domain
 ↑
Infrastructure
```

La arquitectura separa la interfaz de usuario, los casos de uso, los contratos del dominio y las implementaciones concretas de infraestructura.

El modelo utiliza únicamente datos ficticios y se enfoca principalmente en proteger la confidencialidad e integridad de la información manejada por la aplicación y en evitar la exposición de credenciales durante el desarrollo y la integración continua.

---

## 2. Alcance

El modelo considera las funcionalidades y componentes actualmente definidos para CampusOps:

- Sesiones y roles de usuario como parte del modelo previsto.
- Incidencias.
- Fotografías asociadas a incidencias como activo previsto.
- Ubicaciones asociadas a incidencias.
- Asignaciones de trabajo.
- Casos de uso `ListIncidents` y `GetIncident`.
- Contrato `IncidentRepository`.
- Operaciones pendientes sobre incidencias.
- Registros y reportes generados durante la ejecución y CI.
- Credenciales y secretos utilizados por el proyecto y su integración continua.

La arquitectura actual de Semana 02 contiene principalmente la consulta de incidencias. Algunas capacidades de autorización, persistencia externa, sesión y perfiles forman parte de responsabilidades futuras o de controles que deberán verificarse conforme avance la implementación.

---

## 3. Arquitectura relevante para seguridad

La arquitectura actual separa las responsabilidades de la siguiente manera:

```text
UI
 │
 ├── ListIncidents
 └── GetIncident
        │
        ▼
     Domain
        │
        └── IncidentRepository
                 ▲
                 │
     InMemoryIncidentRepository
```

### Domain

El dominio define el modelo y los contratos principales.

Entre los elementos relevantes para este modelo se encuentran:

- `Incident`
- `IncidentRepository`
- `CampusRole`
- `IncidentWork`
- `IncidentLocation`
- `PendingIncidentOperation`

La entidad `Incident` contiene, entre otros datos:

- `id`
- `reporterId`
- `category`
- `description`
- `location`
- `work`
- `version`

`IncidentWork` contiene el identificador del técnico asignado y el estado de la incidencia.

`PendingIncidentOperation` contiene información relacionada con una operación pendiente, incluyendo:

- `operationId`
- `incidentId`
- `baseVersion`
- `actorId`
- `action`
- `payload`

Estos campos son relevantes para evaluar controles de autorización, integridad y exposición de información.

### Application

La capa Application contiene actualmente:

- `ListIncidents`
- `GetIncident`

Los casos de uso utilizan el contrato `IncidentRepository` en lugar de depender directamente de una implementación concreta de infraestructura.

### Infrastructure

La infraestructura contiene actualmente:

- `InMemoryIncidentRepository`

Esta implementación proporciona datos ficticios para desarrollo y pruebas.

### UI

La interfaz utiliza los casos de uso de Application y no debe depender directamente de la implementación concreta del repositorio.

---

## 4. Activos a proteger

| ID   | Activo                  | Descripción                                                                        | Impacto                                 |
| ---- | ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| A-01 | Sesiones y roles        | Información utilizada para identificar al actor y determinar su contexto de acceso | Acceso no autorizado                    |
| A-02 | Incidencias             | Información representada mediante la entidad `Incident`                            | Exposición o modificación no autorizada |
| A-03 | Fotografías             | Evidencia asociada a una incidencia                                                | Exposición de información               |
| A-04 | Ubicaciones             | Información representada mediante `IncidentLocation`                               | Exposición de información               |
| A-05 | Asignaciones            | Información de trabajo representada mediante `IncidentWork.assignedTechnicianId`   | Alteración de operaciones               |
| A-06 | Operaciones pendientes  | Información de `PendingIncidentOperation`, incluyendo actor, acción y payload      | Alteración o ejecución no autorizada    |
| A-07 | Credenciales y secretos | Secretos utilizados para autenticación, servicios o CI                             | Acceso no autorizado                    |
| A-08 | Registros y reportes    | Logs, resultados de pruebas y artefactos generados por el proyecto y CI            | Filtración de información               |

---

## 5. Fronteras de confianza

Se identifican las siguientes fronteras:

### 5.1 Usuario/dispositivo → UI

Los datos proporcionados por el usuario deben considerarse no confiables hasta ser validados.

La interfaz no debe considerarse una frontera suficiente para garantizar autorización, ya que un usuario puede intentar manipular las entradas o invocar operaciones fuera del flujo esperado.

### 5.2 UI → Application

La UI utiliza los casos de uso de Application.

Las reglas de seguridad que requieran autorización no deben depender únicamente de que la UI oculte determinadas opciones.

Los casos de uso y las capas responsables de las operaciones deben validar las condiciones necesarias antes de acceder o modificar información protegida.

### 5.3 Application → Domain

Application utiliza los contratos definidos por Domain.

Los controles deben conservar las reglas de integridad y autorización independientemente de la implementación concreta del repositorio.

### 5.4 Infrastructure → Domain

Infrastructure implementa los contratos definidos por Domain.

Una implementación de persistencia no debe asumir que la existencia de un identificador implica autorización para consultar o modificar una incidencia.

### 5.5 Repositorio → GitHub Actions

El repositorio contiene código, configuración, pruebas y documentación que son procesados por CI.

El workflow debe ejecutar las comprobaciones de seguridad requeridas y contar con los permisos mínimos necesarios.

### 5.6 Aplicación/CI → Registros y reportes

Los datos generados durante pruebas, comprobaciones y workflows no deben contener credenciales reales ni información sensible innecesaria.

Los resultados deben proporcionar evidencia suficiente para determinar si una comprobación pasó o falló sin exponer secretos.

---

## 6. Supuestos

- Los datos utilizados durante las pruebas son ficticios.
- No se utilizarán credenciales reales para demostrar fallos de seguridad.
- Los usuarios pueden tener diferentes roles, incluyendo `reporter`, `technician` y `coordinator`.
- La autenticación por sí sola no implica autorización para todas las operaciones.
- La UI no constituye por sí misma un mecanismo suficiente de autorización.
- `reporterId` puede utilizarse como parte del contexto necesario para determinar el alcance de una incidencia.
- `assignedTechnicianId` representa el técnico asociado al trabajo de una incidencia.
- `PendingIncidentOperation.actorId` identifica al actor asociado con una operación pendiente.
- Los controles de seguridad deben comprobarse mediante pruebas reproducibles.
- Los secretos no deben almacenarse directamente en el código fuente.
- Los workflows de CI deben utilizar únicamente los permisos necesarios.
- Las comprobaciones de CI no deben deshabilitarse para ocultar un incumplimiento.
- Los controles descritos en este documento representan requisitos de seguridad a verificar; no se considera implementado un control únicamente por estar documentado.

---

## 7. Amenazas priorizadas

### T-01 — Consultar incidencias ajenas

**Activo afectado:** A-01, A-02, A-03 y A-04.

**Elementos relacionados:** `reporterId`, `IncidentRepository`, `GetIncident` y datos de `Incident`.

**Amenaza:**

Un usuario autenticado podría intentar consultar una incidencia que pertenece a otro usuario o contexto y obtener información que no está autorizado a visualizar.

La existencia de un identificador de incidencia no debe considerarse suficiente para conceder acceso.

**Impacto:**

Exposición no autorizada de información de incidencias, incluyendo descripción, ubicación u otra evidencia asociada.

**Prioridad:** Alta.

**Control requerido:**

Verificar la autorización del actor antes de devolver información de una incidencia.

La autorización debe aplicarse en el punto responsable de la operación y no depender únicamente de restricciones visuales en la UI.

**Verificación requerida:**

Ejecutar una prueba con un actor ficticio que intente consultar una incidencia fuera de su alcance autorizado y comprobar que la operación sea rechazada.

La prueba debe conservar evidencia del resultado.

---

### T-02 — Alterar asignaciones

**Activo afectado:** A-05 y A-06.

**Elementos relacionados:** `IncidentWork.assignedTechnicianId`, `PendingIncidentOperation.actorId`, `PendingIncidentOperation.action` y `PendingIncidentOperation.payload`.

**Amenaza:**

Un usuario podría intentar modificar el técnico asignado o realizar una operación sobre una incidencia sin contar con autorización suficiente.

También existe el riesgo de que una operación pendiente sea aceptada sin comprobar que el actor tiene permiso para ejecutarla.

**Impacto:**

Pérdida de integridad de las asignaciones y alteración del flujo operativo de las incidencias.

**Prioridad:** Alta.

**Control requerido:**

Validar la autorización del actor antes de crear, modificar o eliminar asignaciones.

Para las operaciones pendientes también debe comprobarse que el actor (`actorId`) tenga autorización para realizar la acción indicada.

Cuando corresponda, deben validarse además las condiciones de integridad asociadas con la versión de la incidencia (`baseVersion` y `version`).

**Verificación requerida:**

Ejecutar una prueba con un actor ficticio sin permisos suficientes que intente modificar una asignación y comprobar que la operación sea rechazada.

La prueba debe demostrar que la asignación no fue modificada como consecuencia del intento no autorizado.

---

### T-03 — Filtrar datos en registros

**Activo afectado:** A-07 y A-08.

**Elementos relacionados:** descripción de incidencias, ubicaciones, identificadores de actores, payloads de operaciones, logs, reportes y artefactos.

**Amenaza:**

Los logs o reportes podrían contener accidentalmente contraseñas, tokens, claves u otros datos sensibles.

También podría registrarse información de una incidencia que no sea necesaria para diagnosticar una ejecución.

**Impacto:**

Exposición de información y posible acceso no autorizado a otros recursos cuando el dato filtrado corresponde a un secreto válido.

**Prioridad:** Alta.

**Control requerido:**

- Evitar registrar secretos.
- Evitar incluir información sensible innecesaria en logs.
- Sanitizar información antes de incorporarla a registros o reportes.
- Utilizar comprobaciones automáticas para detectar posibles secretos.
- Revisar los artefactos generados por CI para evitar exposición accidental.

**Verificación requerida:**

Utilizar únicamente un valor ficticio que represente un secreto en un escenario controlado.

La comprobación debe detectar el valor o patrón y producir un fallo.

Posteriormente se debe eliminar el valor de prueba, ejecutar nuevamente el proceso y conservar evidencia de que el resultado corregido pasa la comprobación.

---

### T-04 — Exponer credenciales

**Activo afectado:** A-07 y A-08.

**Elementos relacionados:** código fuente, archivos de configuración, `.env`, workflows, logs, reportes y artefactos.

**Amenaza:**

Una credencial podría quedar expuesta accidentalmente en el código fuente, configuración, logs, reportes o artefactos generados durante CI.

**Impacto:**

Acceso no autorizado a servicios o recursos protegidos.

**Prioridad:** Alta.

**Control requerido:**

- Mantener secretos fuera del código fuente.
- Utilizar mecanismos seguros de administración de secretos.
- Evitar imprimir secretos en logs.
- Ejecutar secret scanning durante CI.
- Limitar los permisos del workflow a los estrictamente necesarios.

**Verificación requerida:**

Utilizar exclusivamente un secreto ficticio en un escenario controlado para comprobar que la detección identifica el incumplimiento.

El proceso debe producir un fallo útil y proporcionar evidencia de la causa.

Después de retirar el valor de prueba, el workflow debe ejecutarse nuevamente y producir un resultado exitoso.

---

## 8. Matriz de amenazas, controles y verificaciones

| ID   | Amenaza                      | Activos                | Control                                      | Verificación                                       |
| ---- | ---------------------------- | ---------------------- | -------------------------------------------- | -------------------------------------------------- |
| T-01 | Consultar incidencias ajenas | A-01, A-02, A-03, A-04 | Autorización antes de consultar              | Prueba de acceso fuera del alcance autorizado      |
| T-02 | Alterar asignaciones         | A-05, A-06             | Autorización e integridad antes de modificar | Prueba de modificación sin permisos                |
| T-03 | Filtrar datos en registros   | A-07, A-08             | Sanitización y detección de secretos         | Prueba controlada de detección en logs/reportes    |
| T-04 | Exponer credenciales         | A-07, A-08             | Gestión segura de secretos y secret scanning | Prueba con secreto ficticio y posterior corrección |

---

## 9. Relación entre amenazas y arquitectura

Las amenazas se relacionan con la arquitectura de la siguiente forma:

```text
                         ┌──────────────────────┐
                         │        UI            │
                         │ Entradas no confiables│
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    Application       │
                         │ Casos de uso         │
                         │ Autorización requerida│
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │       Domain         │
                         │ Incident             │
                         │ IncidentRepository   │
                         │ IncidentWork         │
                         │ PendingOperation     │
                         └──────────┬───────────┘
                                    ▲
                                    │
                         ┌──────────────────────┐
                         │   Infrastructure     │
                         │ Repository / datos    │
                         └──────────────────────┘
```

Los controles de autorización no deben depender únicamente de la UI.

La capa Application constituye un punto relevante para comprobar las reglas de los casos de uso, mientras que Domain define los contratos y modelos que deben conservar su integridad.

Infrastructure proporciona la implementación concreta del repositorio y debe respetar los contratos establecidos.

---

## 10. Justificación de prioridades

Las cuatro amenazas se consideran de prioridad alta debido al impacto que podrían tener sobre la confidencialidad o integridad de la información de CampusOps.

### T-01

El acceso no autorizado a incidencias puede exponer información asociada con la incidencia, incluyendo descripción, ubicación y evidencia.

### T-02

La modificación no autorizada de asignaciones puede alterar quién es responsable de atender una incidencia y afectar la integridad del flujo operativo.

### T-03

La exposición de información sensible en logs o reportes puede hacer que información que inicialmente estaba protegida quede disponible en artefactos o registros.

### T-04

La exposición de credenciales puede proporcionar acceso a servicios o recursos que no deberían estar disponibles para usuarios o procesos no autorizados.

La prioridad podrá revisarse posteriormente si cambia el alcance de los datos, los permisos o la arquitectura.

---

## 11. Criterios de verificación para Semana 03

Los controles definidos en este documento deberán relacionarse con comprobaciones reproducibles.

La evidencia esperada debe permitir distinguir al menos los siguientes estados:

### Escenario de incumplimiento

Una condición controlada que viole un requisito de seguridad debe producir un resultado fallido.

El fallo debe indicar de manera útil qué comprobación no se cumplió.

### Escenario corregido

Después de retirar o corregir la condición de incumplimiento, el mismo proceso debe ejecutarse nuevamente y producir un resultado exitoso.

### Evidencia

La evidencia debe conservar información suficiente para identificar:

- comprobación ejecutada;
- resultado;
- condición que produjo el fallo;
- corrección aplicada;
- resultado posterior a la corrección.

Las demostraciones deben utilizar únicamente valores ficticios.

---

## 12. Riesgo residual

Los controles definidos reducen los riesgos identificados, pero no eliminan completamente la posibilidad de incidentes.

Permanece un riesgo residual asociado con:

- errores de implementación;
- configuraciones incorrectas;
- nuevas rutas de acceso no contempladas;
- controles de autorización incompletos;
- secretos que no sean detectados por una herramienta;
- falsos negativos en mecanismos de secret scanning;
- exposición accidental de información en nuevos logs o artefactos;
- futuras implementaciones de persistencia o servicios externos.

La implementación de nuevos proveedores de persistencia, autenticación, perfiles o servicios externos deberá reevaluar las fronteras de confianza y los controles correspondientes.

Por esta razón, los controles deben mantenerse acompañados de pruebas automatizadas, revisiones de código y comprobaciones periódicas de CI.

---

## 13. Datos utilizados

Todas las pruebas y ejemplos relacionados con este modelo deben utilizar datos ficticios.

No deben incluirse:

- credenciales reales;
- contraseñas reales;
- tokens válidos;
- claves reales;
- información personal real;
- ubicaciones reales sensibles;
- datos de usuarios reales.

Los valores utilizados para demostrar la detección de secretos deben ser deliberadamente ficticios y no deben proporcionar acceso a ningún servicio real.

---

## 14. Estado del modelo

Este documento representa el modelo de amenazas inicial de CampusOps para la Semana 03.

Los controles descritos deben considerarse requisitos de seguridad que deberán comprobarse mediante las pruebas y el proceso de integración continua correspondiente.

La documentación no implica que todos los controles ya estén implementados.

Cualquier cambio posterior en:

- autenticación;
- autorización;
- persistencia;
- asignaciones;
- perfiles;
- ubicación;
- almacenamiento de fotografías;
- integración con servicios externos;
- workflows de CI;

deberá evaluarse para determinar si introduce nuevos activos, fronteras de confianza o amenazas.
