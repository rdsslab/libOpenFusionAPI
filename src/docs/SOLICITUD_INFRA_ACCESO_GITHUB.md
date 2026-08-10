# Solicitud a Infraestructura — habilitar salida HTTPS a raw.githubusercontent.com

> Documento de apoyo. El cuerpo del correo está listo para copiar y pegar.
> Sustituir los campos entre `<>` antes de enviar.
>
> **Contexto interno (no enviar):** el endpoint `GET /api/system/libopenfusionapi/version/last/prd`
> falla con HTTP 500 tras 10,5 s desde el 07-ago-2026 por bloqueo de salida.
> En paralelo se desplegó la corrección de resiliencia en `src/lib/db/default/system.js`
> (endpoint `0686803b-4817-48cd-9e9a-38807bdd7a98`), que degrada el fallo a HTTP 200
> con el último valor conocido. Esa corrección **no sustituye** a esta solicitud.

---

## Cuerpo del correo

**Para:** \<infraestructura / redes / seguridad perimetral\>
**CC:** \<jefatura de TI\>
**Asunto:** Solicitud de habilitación de salida HTTPS a raw.githubusercontent.com desde el servidor 172.16.243.104 (OpenFusionAPI)

---

Estimados,

Solicito la habilitación de tráfico saliente HTTPS desde el servidor de aplicaciones OpenFusionAPI hacia el dominio `raw.githubusercontent.com`, actualmente bloqueado.

### 1. Resumen

La plataforma OpenFusionAPI consulta periódicamente el archivo de manifiesto público del repositorio de su propia librería para informar a los administradores si existe una versión más reciente disponible. Desde el 7 de agosto de 2026 esa consulta falla de forma sistemática porque el servidor no logra establecer conexión TCP con el destino.

### 2. Detalle técnico de la solicitud

| Parámetro | Valor |
|---|---|
| Servidor origen | `172.16.243.104` (servicio OpenFusionAPI, puerto de escucha 3033) |
| Destino | `raw.githubusercontent.com` |
| Puerto / protocolo | `443/TCP` (HTTPS) |
| Sentido | Saliente únicamente (el servidor inicia la conexión) |
| Tipo de tráfico | GET HTTP sobre TLS a un archivo de texto público, sin autenticación |
| Volumen estimado | Menos de 15 peticiones por hora, respuesta inferior a 5 KB |
| Datos transmitidos | Ninguno. Es una lectura; no se envía información de la organización |

**Importante — solicitamos la regla por nombre de dominio (FQDN), no por dirección IP.** Las direcciones IP de este servicio pertenecen al CDN de GitHub y **rotan**: en nuestros propios registros ya observamos el cambio de `185.199.109.133` a `185.199.110.133` entre el 7 y el 10 de agosto. Una regla basada en IP fija volverá a fallar. Si su plataforma de firewall no soporta reglas por FQDN, GitHub publica sus rangos oficiales y actualizados en `https://api.github.com/meta` (campo `web`), que a la fecha comprenden `185.199.108.0/22`.

### 3. Evidencia del bloqueo

El servidor registra el siguiente error en cada intento:

```
ConnectTimeoutError: Connect Timeout Error
  (attempted addresses: 185.199.110.133:443, timeout: 10000ms)
  code: UND_ERR_CONNECT_TIMEOUT
```

Interpretación: la resolución DNS **funciona correctamente** (el sistema obtiene una dirección IP válida). Lo que no completa es el establecimiento de la conexión TCP: el servidor envía el paquete SYN y nunca recibe respuesta, agotando el tiempo de espera de 10 segundos. Este comportamiento —ausencia total de respuesta en lugar de un rechazo inmediato— corresponde a un dispositivo intermedio que **descarta** los paquetes de forma silenciosa, típicamente una regla de firewall en modo DROP.

### 4. Ventana en la que se produjo el cambio

Nuestros registros acotan el corte con precisión:

| Fecha y hora | Resultado | Tiempo de respuesta |
|---|---|---|
| 07-ago-2026 15:31 | Correcto | 238 ms |
| 07-ago-2026 15:42 | Correcto | 276 ms |
| 07-ago-2026 16:40 | **Fallo** | 10.501 ms |
| 07-ago-2026 16:50 | **Fallo** | 10.586 ms |
| 07-ago-2026 17:32 | **Fallo** | 10.509 ms |
| 10-ago-2026 14:13 | **Fallo** | 10.509 ms |
| 10-ago-2026 14:37 | **Fallo** | 10.733 ms |

Hasta las 15:42 del 7 de agosto la conexión funcionaba con normalidad y en menos de 300 ms. A partir de las 16:40 de ese mismo día falla el 100 % de los intentos. **Agradeceríamos que se revise qué cambio de configuración de red, política de seguridad o actualización de reglas se aplicó en esa ventana**, ya que podría estar afectando a otros servicios además de este.

Descartamos que sea un problema de una estación de trabajo concreta: los fallos se reproducen desde equipos cliente distintos (`172.16.244.220` y `10.212.132.20`), lo que confirma que el bloqueo está del lado del servidor.

### 5. Impacto

- Los administradores de la plataforma no reciben aviso cuando hay una versión nueva de la librería disponible, lo que retrasa la aplicación de correcciones de seguridad y estabilidad.
- Cada intento fallido mantiene un proceso del servidor ocupado durante 10 segundos sin realizar trabajo útil.
- El servicio genera errores HTTP 500 registrados en el sistema de monitoreo, que consumen atención del equipo de desarrollo.

Estamos desplegando en paralelo una corrección en la aplicación para que este fallo se degrade de forma controlada en lugar de generar un error. **Esa corrección mitiga el síntoma, pero no sustituye a esta solicitud**: sin acceso al origen, la funcionalidad de detección de actualizaciones permanece inoperativa.

### 6. Consideraciones de seguridad

- `raw.githubusercontent.com` es el servicio oficial de GitHub para servir archivos de repositorios en texto plano. Es un destino de solo lectura.
- La conexión es **exclusivamente saliente**. No se abre ningún puerto entrante ni se expone el servidor.
- No se transmite información de la organización: la petición es un GET a una ruta pública fija.
- Ruta consultada: `https://raw.githubusercontent.com/rdsslab/libOpenFusionAPI/main/package.json`
- Si su política requiere restringir el alcance, la regla puede limitarse a ese único FQDN, sin habilitar el resto de dominios de GitHub.

### 7. Alternativa si la habilitación directa no es viable

Si la política corporativa no permite salida directa a internet desde este segmento, podemos adaptar la aplicación para usar el proxy corporativo. En ese caso necesitaríamos: dirección y puerto del proxy, si requiere autenticación y de qué tipo, y si `raw.githubusercontent.com` está permitido en su lista de destinos. Requeriría desarrollo adicional de nuestra parte, por lo que **preferimos la habilitación directa por FQDN** si es posible.

Quedo atento a sus comentarios y a la información adicional que necesiten. Puedo facilitar registros completos, capturas de tráfico o realizar pruebas de conectividad coordinadas en el momento que les convenga.

Saludos cordiales,

Edwin De La Cruz
\<cargo\> — \<área\>
edwindelacruz@farmaenlace.com
\<teléfono / extensión\>

---

## Anexo para el ticket

Adjuntar si el proceso de Infraestructura lo requiere.

```
Servidor origen:     172.16.243.104
Servicio:            OpenFusionAPI (puerto 3033)
Destino FQDN:        raw.githubusercontent.com
Puerto/protocolo:    443/TCP saliente
IPs observadas:      185.199.109.133 / 185.199.110.133 (CDN GitHub, rotativas)
Rango oficial:       185.199.108.0/22 (fuente: https://api.github.com/meta, campo "web")
Codigo de error:     UND_ERR_CONNECT_TIMEOUT (ConnectTimeoutError)
Ultima conexion OK:  2026-08-07 15:42 (276 ms)
Primer fallo:        2026-08-07 16:40 (10.501 ms)

Trace IDs de ejemplo:
  43393bcc-232d-439d-ac2d-709639778452  (2026-08-10 14:13:51)
  0e01aad7-d5dc-421a-a31a-7dac755e19d5  (2026-08-10 14:37:40)
  5fce9d39-57bd-45d6-a6e8-0b86f3a4695b  (2026-08-07 17:35:48)
```

### Comandos de comprobación para el equipo de redes

Ejecutar **desde** `172.16.243.104`. Si la regla queda bien aplicada, los tres deben responder.

```bash
# 1. Resolucion DNS (hoy ya funciona)
nslookup raw.githubusercontent.com

# 2. Alcance TCP al puerto 443 (hoy falla por timeout)
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" \
  --max-time 10 https://raw.githubusercontent.com/rdsslab/libOpenFusionAPI/main/package.json

# 3. Verificacion extremo a extremo del endpoint de la plataforma
curl -sS http://localhost:3033/api/system/libopenfusionapi/version/last/prd
#    Esperado tras la habilitacion: {"libOpenFusionAPI":{"version":"..."},"disponible":true,"origen":"github",...}
```

## Seguimiento

| Fecha | Acción | Estado |
|---|---|---|
| \<dd-mmm\> | Correo enviado a Infraestructura | \<pendiente\> |
| \<dd-mmm\> | Ticket abierto n.º \<id\> | \<pendiente\> |
| \<dd-mmm\> | Regla aplicada / respuesta recibida | \<pendiente\> |
| \<dd-mmm\> | Verificación end-to-end (comando 3) | \<pendiente\> |
