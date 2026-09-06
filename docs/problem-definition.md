# Definición del problema — CampusOps

## Problema

Las instalaciones del campus universitario presentan incidentes y necesidades de mantenimiento que suelen reportarse de manera dispersa, dificultando su seguimiento, asignación y resolución oportuna. Esto provoca retrasos en la atención de fallas eléctricas, daños en laboratorios y salones, problemas de conectividad, fugas de agua y riesgos de seguridad, afectando las actividades académicas y operativas. 
CampusOps busca atender la problemática de la falta de un mecanismo centralizado para reportar y dar seguimiento a fallas e incidentes en las instalaciones del campus

## Alcance

Gestión integral del ciclo de vida de incidencias relacionadas con infraestructura, equipamiento y mantenimiento dentro del campus universitario, desde su reporte hasta su cierre.

### Incluye

- Registro de incidencias relacionadas con infraestructura, mantenimiento y equipamiento del campus.
- Captura de información detallada de la incidencia: categoría, descripción, ubicación y nivel de prioridad.
- Adjuntar evidencias fotográficas para documentar el problema reportado.
- Consulta y seguimiento del estado de las incidencias en tiempo real por parte de los usuarios autorizados.
- Asignación y reasignación de incidencias a técnicos responsables de su atención.
- Gestión del ciclo de vida de una incidencia (abierta, asignada, en proceso, resuelta y cerrada).
- Registro de diagnósticos, observaciones y acciones correctivas realizadas por los técnicos.
- Historial completo de cambios, asignaciones y actividades realizadas sobre cada incidencia.
- Reapertura de incidencias cuando la solución aplicada no resuelva completamente el problema.
- Operación básica sin conexión a Internet, permitiendo almacenar cambios para sincronizarlos posteriormente.
- Control de acceso basado en roles (Reportante, Técnico y Coordinador).
- Generación de reportes y métricas sobre incidencias atendidas, pendientes y tiempos de resolución.

### No incluye

- Gestión de emergencias médicas, incendios o situaciones que requieran atención inmediata de cuerpos especializados.
- Sistemas de videovigilancia o monitoreo en tiempo real.
- Comunicación mediante chat en tiempo real entre usuarios.
- Gestión de pagos, compras o presupuestos de mantenimiento.
- Integración con sistemas institucionales reales o bases de datos externas.
- Inteligencia artificial para diagnóstico automático de fallas.
- Administración de recursos humanos o control de asistencia del personal.
- Publicación de información para usuarios externos al campus.

## Actores y responsabilidades

- **Reportante:** Registrar incidencias detectadas en las instalaciones del campus, seleccionando la categoría correspondiente, describiendo el problema, indicando la ubicación y adjuntando evidencias fotográficas cuando sea necesario. Además, puede consultar el estado de sus reportes y agregar información adicional posteriormente.

- **Técnico:** Consultar las incidencias asignadas, iniciar el proceso de atención, realizar el diagnóstico, registrar notas y evidencias del trabajo efectuado, actualizar el estado de la incidencia y marcarla como resuelta una vez concluida la intervención.

- **Coordinador:** Supervisar todas las incidencias registradas, establecer prioridades, asignar o reasignar técnicos, revisar el historial y las evidencias generadas durante la atención, validar la resolución y cerrar o reabrir casos cuando sea necesario.

## Flujo principal

1. Reportar: El reportante crea una incidencia indicando la categoría del problema, descripción detallada, ubicación afectada y evidencias fotográficas opcionales. La incidencia queda registrada con estado abierta.

2. Asignar: El coordinador revisa la incidencia, determina su prioridad y asigna un técnico responsable para su atención. El estado cambia a asignada.

3. Atender: El técnico analiza el problema, realiza las acciones correctivas necesarias, registra diagnósticos, notas y evidencias de la intervención. Durante esta etapa la incidencia pasa a estado en proceso y posteriormente a resuelta.

4. Cerrar: El coordinador verifica que la solución sea satisfactoria, revisa la evidencia registrada y procede a cerrar la incidencia. Si la solución no es adecuada, puede reabrir el caso para una nueva atención.

## Criterios de aceptación verificables

1. Dado que un reportante completa los campos obligatorios de categoría, descripción y ubicación, cuando registra una incidencia, entonces el sistema debe crear el reporte con estado Abierta y asignarle un identificador único.

2. Dado que existe una incidencia abierta, cuando el coordinador asigna un técnico responsable, entonces el sistema debe cambiar el estado a Asignada y registrar la acción en el historial de la incidencia.

3. Dado que una incidencia está asignada a un técnico, cuando este inicia su atención, entonces el sistema debe actualizar el estado a En proceso y registrar la fecha y hora de inicio.

4. Dado que un técnico atiende una incidencia, cuando registra un diagnóstico o evidencia fotográfica, entonces la información debe almacenarse y quedar disponible en el historial de la incidencia.

5. Dado que una incidencia ha sido atendida, cuando el técnico marca la intervención como finalizada, entonces el sistema debe cambiar el estado a Resuelta.

6. Dado que una incidencia se encuentra en estado Resuelta, cuando el coordinador valida la solución, entonces el sistema debe cambiar el estado a Cerrada y conservar el historial completo de acciones realizadas.

7. Dado que una incidencia cerrada requiere atención adicional, cuando el coordinador decide reabrirla, entonces el sistema debe regresar la incidencia al estado Asignada y mantener el historial previo.

8. Dado que un usuario consulta una incidencia, cuando accede a su detalle, entonces debe visualizar la descripción, ubicación, estado actual, responsable asignado e historial de actividades.

9. Dado que un técnico realiza cambios mientras no tiene conexión a Internet, cuando la conectividad se restablece, entonces el sistema debe sincronizar la información sin perder los cambios realizados.

10. Dado que un usuario intenta acceder a funcionalidades que no corresponden a su rol, cuando realiza la acción, entonces el sistema debe impedir el acceso y mostrar un mensaje de autorización insuficiente.


