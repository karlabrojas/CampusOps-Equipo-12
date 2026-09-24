## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | La aplicación utiliza un backend HTTP sin cifrado para las comunicaciones | Las peticiones y respuestas podrían ser interceptadas o modificadas en redes inseguras | Migrar la URL del backend a HTTPS o documentar explícitamente que HTTP sólo se utiliza en entornos de desarrollo | Captura de la configuración del backend y prueba de conexión |
| 2 | El repositorio contiene un backend de pruebas con autenticación basada en tokens estáticos de ejemplo | Si estos valores se reutilizaran en un entorno real podrían permitir accesos no autorizados o generar una falsa sensación de seguridad | Mover los valores a variables de entorno y utilizar credenciales temporales o generadas dinámicamente | Comparación antes/después del código |
| 3 | Existe riesgo de exposición accidental de variables de entorno si no se verifica continuamente el estado del repositorio | Un archivo `.env` agregado por error podría terminar publicado junto con el código | Mantener `.env` en `.gitignore` y demostrar mediante `git status` que no se encuentra bajo seguimiento | Salida de `git status` |