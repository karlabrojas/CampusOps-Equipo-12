# Relacion con amenazas — Issue #20 / Issue #5 (AC-03)

## Amenazas cubiertas (docs/threat-model.md)

- **A-02 — Incidencias**: informacion representada mediante la entidad `Incident`.
  Riesgo: exposicion o modificacion no autorizada.
- **A-04 — Ubicaciones**: informacion representada mediante `IncidentLocation`.
  Riesgo: exposicion de informacion.
- Nota general del modelo: *"La exposicion de informacion sensible en logs o reportes
  puede hacer que informacion que inicialmente estaba protegida quede disponible en
  artefactos o registros."*

## Que se implemento

`src/campusops/security/incidentPrivacy.ts` construye una version enmascarada
(`maskIncidentForViewer`) de un `Incident` para cualquier persona que no sea el
`reporterId` original: oculta `reporterId` y `location.label` con `[HIDDEN]`.

Esta version enmascarada es la unica que se usa para:
- generar logs (`logIncidentEvent`),
- guardar en preferencias/storage (`saveLastViewedIncident`),
- generar reportes (`generateIncidentReport`).

## Pruebas ejecutadas

Archivo: `src/campusops/security/t05-hidden-data-persistence.test.ts`
Comando: `npx jest t05-hidden-data-persistence --verbose`
Resultado: 8/8 pruebas en verde (ver `reports/week-04/t05-jest-output.txt`).

Casos cubiertos:
1. Nominal — el dueno ve sus datos reales.
2. Failure — un tercero no ve `reporterId` ni `location` reales.
3. Failure — el log generado no contiene el dato real (mitiga A-02, A-04 y la nota
   de exposicion en logs).
4. Failure — el storage/preferencias guarda solo la version enmascarada.
5. Failure — el reporte generado no expone el dato real (mitiga la nota de
   exposicion en reportes/artefactos).
6. Boundary — un incidente inexistente no expone datos ni produce cierre inesperado
   (camino de error manejado de forma segura, sin excepcion no controlada).
7. Nominal — el objeto `Incident` original no se modifica (sin corrupcion de datos).
8. Boundary — el dueno real sigue viendo sus datos tras un intento fallido previo.

## Evidencia

- `reports/week-04/negative-tests.json`
- `reports/week-04/t05-jest-output.txt`
- `reports/week-04/t05-git-status.txt`
