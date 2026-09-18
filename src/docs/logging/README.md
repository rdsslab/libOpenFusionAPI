# Endpoint Logging — Configuración de verborrea por status

> **READ ME FIRST**: este documento define el contrato completo de `endpoint.ctrl.log`
> (la parametrización de cuándo y cuánto se registra por clase de status). Es la
> fuente de verdad que usan `EndpointLogger` (runtime), `endpoint_upsert` (escritura)
> y las tools de lectura (`read_endpoint_data`, `app_endpoints`) para decidir cuánto
> capturar por respuesta HTTP.

---

## 1. Dónde se guarda

Cada endpoint persiste un objeto JSON en la columna `ctrl` del modelo `Endpoint`.
Dentro llevas la sub-clave de logging:

```json
"ctrl": {
  "log": {
    "status_info": 1,
    "status_success": 1,
    "status_redirect": 1,
    "status_client_error": 2,
    "status_server_error": 3
  }
}
```

Solo se admiten **estas cinco claves**. Cualquier otra clave (o un `log` que no sea
un objeto, o un valor fuera de rango) se rechaza al guardar con el error
`INVALID_LOG_LEVEL` (HTTP 400) y `details` describiendo el campo conflictivo.

---

## 2. Semántica de los niveles

| Valor | Significado | Qué se captura (Endloggger) |
|-------|-------------|------------------------------|
| 0 | Disabled | No se registra nada para esa clase de status. |
| 1 | Basic    | Datos mínimos: timestamp, status, ids, tiempo de respuesta. |
| 2 | Normal   | Añade params/query/body que llegaron en la petición. |
| 3 | Full     | Añade headers completos y datos sensibles de la respuesta. |

Los niveles son **por clase de status** (cada clave mapea a un rango de códigos):

| Clave               | Rango HTTP |
|---------------------|------------|
| `status_info`       | 1xx        |
| `status_success`    | 2xx        |
| `status_redirect`   | 3xx        |
| `status_client_error`| 4xx       |
| `status_server_error`| 5xx       |

---

## 3. Defaults

Cuando una clave (o todo `log`) se omite:

| Clave                | Default |
|----------------------|---------|
| `status_info`        | 1       |
| `status_success`     | 1       |
| `status_redirect`    | 1       |
| `status_client_error`| 2       |
| `status_server_error`| 3       |

En un INSERT se usa el default. En un UPDATE solo se modifican las claves enviadas;
el resto conserva su valor almacenado.

---

## 4. Cómo lo lee el runtime

`EndpointLogger` (src/lib/server/endpoint/EndpointLogger.js) en cada respuesta:
1. Lee `endpoint.ctrl.log` (vía la columna persistida `ctrl`).
2. Determina la clase de status con `getLogLevelForStatus(status)` (utils.js).
3. Aplica el nivel y genera el log (con `$_RETURN_DATA_` truncado según nivel).

Si `ctrl.log` no está, se aplican los defaults (apartado 3).

---

## 5. Cómo lo modificas desde MCP

La tool `endpoint_upsert` acepta `ctrl.log`. Ejemplo — subir solo `status_server_error`
a nivel Pleno (3) sin tocar el resto:

```json
{
  "idapp": "<idapp>",
  "resource": "mis-recursos",
  "method": "GET",
  "handler": "TEXT",
  "ctrl": {
    "log": { "status_server_error": 3 }
  }
}
```

En un UPDATE, omite las claves que no quieras cambiar. En un INSERT, las que omitas
cogen el default del apartado 3.

---

## 6. Contrato de error

Si envías `ctrl.log` inválido (clave desconocida, valor no entero, o fuera de 0-3),
`upsertEndpoint` lanza un error con `code = "INVALID_LOG_LEVEL"` y `details` con la
clave y el valor conflictivos. `fnEndpointUpsert` lo devuelve como HTTP 400 para que
los agentes puedan detectarlo y corregirlo sin un 500 genérico.

---

## Ver también

- `src/lib/db/endpoint.js` — validación `validateLogLevelControl`.
- `src/docs/logging/AI_SKILL.md` — versión condensada para agentes.
- `src/docs/handlers/JS/README.md` — parámetro `log_level` por petición.
