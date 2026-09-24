# Security and Privacy Audit

## 1. Resumen

Se realizó una revisión de seguridad y privacidad del proyecto CampusOps, considerando dependencias, secretos, logs, workflows y pruebas automatizadas.

Durante la auditoría se identificaron tres problemas de seguridad:

1. Vulnerabilidades de seguridad en la dependencia `@xmldom/xmldom`.
2. Vulnerabilidad de seguridad en la dependencia `js-yaml`.
3. Cobertura incompleta del escáner de secretos para detectar tokens Bearer y valores sensibles dentro de payloads JSON.

Los dos primeros problemas fueron corregidos mediante la actualización de dependencias con `npm audit fix`.

El tercer problema fue atendido ampliando los patrones utilizados por el escáner de secretos y agregando pruebas automatizadas para comprobar la nueva cobertura. Durante la verificación se detectaron falsos positivos en fixtures y archivos de prueba, por lo que este control requiere un ajuste adicional.

---

## 2. Hallazgos

| #     | Hallazgo                                     | Riesgo                                                                                                            | Solución aplicada                                                                                  | Evidencia                      |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| H-001 | Vulnerabilidades en `@xmldom/xmldom`         | Procesamiento inseguro de XML, incluyendo posibles inyecciones y consumo excesivo de recursos                     | Se actualizaron las versiones vulnerables mediante `npm audit fix`                                 | `docs/evidence/hallazgo-1.png` |
| H-002 | Vulnerabilidad en `js-yaml`                  | Consumo excesivo de CPU al procesar determinadas estructuras YAML                                                 | Se actualizaron las versiones vulnerables mediante `npm audit fix`                                 | `docs/evidence/hallazgo-2.png` |
| H-003 | Cobertura incompleta del escáner de secretos | Un secreto enviado como Bearer token o como valor de un campo sensible JSON podía no ser detectado por el escáner | Se agregaron patrones para Bearer tokens y valores sensibles JSON, junto con pruebas automatizadas | `docs/evidence/hallazgo-3.png` |

---

## 3. Hallazgo H-001 — Vulnerabilidades en @xmldom/xmldom

### Problema

La auditoría de dependencias reportó vulnerabilidades de seguridad relacionadas con el procesamiento y serialización XML de `@xmldom/xmldom`.

La versión afectada directamente era `0.8.14`.

### Riesgo

Una dependencia vulnerable puede introducir riesgos de seguridad en cualquier componente que la utilice, especialmente cuando procesa datos XML.

Las vulnerabilidades reportadas incluían problemas relacionados con inyección, validación y consumo excesivo de recursos.

### Antes

La auditoría mostraba vulnerabilidades de severidad alta mediante:

```bash
npm audit --omit=dev
```

### Solución

Se ejecutó:

```bash
npm audit fix
```

La dependencia fue actualizada de:

```text
@xmldom/xmldom 0.8.14 → 0.8.15
```

También se actualizó la dependencia anidada utilizada por `plist`:

```text
@xmldom/xmldom 0.9.11 → 0.9.12
```

### Después

Se ejecutó nuevamente:

```bash
npm audit --omit=dev
```

Resultado:

```text
found 0 vulnerabilities
```

### Evidencia

```text
docs/evidence/hallazgo-1.png
```

---

## 4. Hallazgo H-002 — Vulnerabilidad en js-yaml

### Problema

La auditoría de dependencias detectó una vulnerabilidad en `js-yaml` relacionada con consumo excesivo de CPU al procesar determinadas estructuras de merge.

La versión afectada era `3.15.1`.

### Riesgo

Una entrada especialmente construida podría provocar un consumo elevado de recursos durante el procesamiento de YAML.

### Antes

La auditoría reportaba una vulnerabilidad de severidad alta mediante:

```bash
npm audit --omit=dev
```

### Solución

Se ejecutó:

```bash
npm audit fix
```

La dependencia principal fue actualizada de:

```text
js-yaml 3.15.1 → 3.15.2
```

También se actualizaron dependencias anidadas:

```text
js-yaml 4.3.1 → 4.3.2
```

### Después

Se verificó nuevamente:

```bash
npm audit --omit=dev
```

Resultado:

```text
found 0 vulnerabilities
```

También se ejecutó:

```bash
npm run audit:ci
```

Resultado:

```text
found 0 vulnerabilities
```

### Evidencia

```text
docs/evidence/hallazgo-2.png
```

---

## 5. Hallazgo H-003 — Cobertura incompleta del escáner de secretos

### Problema

Durante la revisión del control de detección de secretos se observó que `secretScan.ts` detectaba algunos tipos de credenciales, como claves privadas, tokens de GitHub y claves AWS, pero no contemplaba explícitamente:

- valores de encabezados `Bearer`;
- valores almacenados en campos sensibles de JSON como `password`, `token`, `secret`, `apiKey` o `access_token`.

Esto representaba una cobertura incompleta del control de detección de secretos.

### Riesgo

Un secreto almacenado en uno de esos formatos podría llegar al repositorio sin ser detectado por el escáner automatizado.

Esto incrementaría el riesgo de exposición accidental de credenciales.

### Antes

El escáner contenía patrones para:

```text
private_key
github_token
aws_access_key
public_secret_name
```

pero no tenía patrones específicos para:

```text
Bearer tokens
valores sensibles dentro de JSON
```

### Solución

Se agregaron patrones específicos para detectar ambos casos:

```ts
bearer_token:
/\bBearer\s+\S+/i,

json_secret_value:
/"(?:password|token|secret|apiKey|api_key|access_token)"\s*:\s*"[^"]+"/i,
```

También se agregaron pruebas automatizadas para comprobar la nueva cobertura.

Los valores utilizados en las pruebas son ficticios y no corresponden a credenciales reales.

### Después

El escáner ahora identifica ejemplos como:

```text
Authorization: Bearer valor-ficticio-123
```

y valores sensibles contenidos en estructuras JSON.

Durante la ejecución de `npm run test:security` se detectaron falsos positivos en fixtures y archivos de prueba que contienen ejemplos ficticios de tokens. Por esta razón, aunque los nuevos patrones fueron implementados, el control requiere un ajuste adicional para distinguir correctamente fixtures educativos de secretos reales.

### Evidencia

```text
docs/evidence/hallazgo-3.png
```

---

## 6. Controles de seguridad verificados

### Secret scanning

El escáner de secretos cuenta con patrones para detectar diferentes tipos de información sensible.

Los valores utilizados en las pruebas son ficticios y se construyen de forma que no representen credenciales reales.

Durante la verificación de T-04 se detectaron falsos positivos relacionados con fixtures y archivos de prueba.

**Resultado:**

```text
REQUIERE AJUSTE — falsos positivos detectados en T-04
```

### Redacción de logs

El proyecto cuenta con `redactSecrets`, que elimina o reemplaza información sensible antes de utilizarla en registros.

Se contemplan:

- claves privadas;
- tokens de GitHub;
- claves AWS;
- encabezados Bearer;
- campos sensibles JSON.

### Integridad del workflow

Se revisó el workflow de seguridad y no se detectaron indicadores de bypass.

**Resultado:**

```text
PASS
```

### Typecheck

Comando:

```bash
npm run typecheck
```

Resultado de la verificación realizada:

```text
PASS
```

### Lint

Comando:

```bash
npm run lint
```

Resultado de la verificación realizada:

```text
PASS
```

### Pruebas de seguridad

Comando:

```bash
npm run test:security
```

Resultado de la verificación:

```text
FAIL — T-04 detecta falsos positivos en fixtures y archivos de prueba.
```

El fallo no corresponde a la presencia de credenciales reales, sino a que el escáner ampliado también identifica patrones dentro de archivos educativos, pruebas y documentación.

---

## 7. Variables de entorno y archivos sensibles

El archivo `.env` no se encuentra versionado y está incluido en `.gitignore`.

El repositorio utiliza:

```text
.env.example
```

como plantilla para las variables de entorno.

El archivo `.env.example` contiene únicamente la configuración necesaria para el backend educativo y no contiene credenciales reales.

Se verificó además que no existen archivos `.env` versionados mediante:

```bash
git ls-files | grep -E '(^|/)\.env($|\.local$|\.production$|\.development$)' || true
```

No se encontraron archivos `.env` versionados.

---

## 8. Valores utilizados por las pruebas

El proyecto contiene valores como:

```text
course-valid-token
course-refresh-0
```

Estos valores corresponden a fixtures públicos del entorno educativo y no representan credenciales reales de producción.

También existen valores ficticios utilizados por las pruebas de redacción y detección de secretos.

Estos valores no deben considerarse secretos reales ni utilizarse como credenciales de producción.

---

## 9. Verificación final

Se ejecutaron las siguientes verificaciones:

### Auditoría de dependencias

```bash
npm audit --omit=dev
```

Resultado:

```text
found 0 vulnerabilities
```

### Auditoría utilizada por CI

```bash
npm run audit:ci
```

Resultado:

```text
found 0 vulnerabilities
```

### Pruebas de seguridad

```bash
npm run test:security
```

Resultado:

```text
FAIL — T-04 detecta falsos positivos en fixtures y archivos de prueba.
```

### Typecheck

```bash
npm run typecheck
```

Resultado:

```text
PASS
```

### Lint

```bash
npm run lint
```

Resultado:

```text
PASS
```

---

## 10. Estado final

| Control                              | Estado                               |
| ------------------------------------ | ------------------------------------ |
| Vulnerabilidades de `@xmldom/xmldom` | Corregidas                           |
| Vulnerabilidad de `js-yaml`          | Corregida                            |
| Detección de Bearer tokens           | Implementada                         |
| Detección de valores sensibles JSON  | Implementada                         |
| Secret scanning del repositorio      | Requiere ajuste por falsos positivos |
| `.env` versionado                    | No                                   |
| Redacción de logs                    | PASS                                 |
| Workflow integrity                   | PASS                                 |
| Typecheck                            | PASS                                 |
| Lint                                 | PASS                                 |
| Pruebas de seguridad                 | FAIL — falsos positivos en T-04      |
