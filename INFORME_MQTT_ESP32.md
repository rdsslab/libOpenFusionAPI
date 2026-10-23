# Informe: Integración de MQTT en libOpenFusionAPI (ESP32)

**Repositorio:** `/home/edwinspire/Desarrollo/libOpenFusionAPI`  
**Versión:** `13.13.5` (`type: "module"`, ESM, Fastify/Sequelize)  
**Fecha:** 20 oct 2026  
**Autor:** análisis de arquitectura + subagente `ses_ea524fa87ffec3tACgQpkTlF4P`

---

## 1. Resumen ejecutivo

Se puede agregar un handler `MQTT` siguiendo el patrón existente (`HIVE_DRIVER`, `MONGODB`, `MCP`). El proyecto **no tiene MQTT hoy** (`grep mqtt` = vacío; `package.json` sin `mqtt`). Requeriría: un archivo handler, registro en `handler.js`, docs y (opcional) registro en el GUI hermano (`libOpenFusionAPIGUI`). El impacto es **moderado** si se acota a un cliente MQTT por endpoint con timeout; **alto** si se intenta streaming en tiempo real, porque el framework es estrictamente **request/response**.

**Recomendación:** usar MQTT como **puente de publicación/suscripción entre ESP32 y el endpoint HTTP**, no como reemplazo de WebSocket. Para ESP32 es ideal porque `PubSubClient` es nativo.

---

## 2. Cómo funcionaría (arquitectura del proyecto)

### 2.1 Patrón de registry existente (verificado)

```
src/lib/handler/handler.js  (líneas 16-105)
  Handlers = { JS, FETCH, SOAP, SQL, HIVE_DRIVER, MONGODB, MCP, ... }
```

Para agregar `MQTT`:
1. **Implementación:** `src/lib/handler/mqttFunction.js`
2. **Registro:** importar y agregar a `Handlers` en `handler.js`
3. **Config:** `method.custom_data` (JSON) con broker + topic + acción (`publish` / `subscribe` / `readOnce`)
4. **Variables:** `$_VAR_MQTT_CONFIG` via `AppVars` (resuelto por `resolveAppVarPlaceholder` en `utils.js`)
5. **Docs:** `src/docs/handlers/MQTT/README.md`, `manifest.json`, `AI_SKILL.md`
6. **GUI:** agregar en `HANDLER_TABS` del repo `libOpenFusionAPIGUI` (separado)

### 2.2 Flujo con ESP32 — 3 patrones posibles

| Patrón | Dirección | Endpoint HTTP | ESP32 | Notas |
|--------|-----------|---------------|-------|-------|
| **A. Publish (API → ESP)** | Cliente → Broker → ESP32 | `POST /api/esp32/cmd` envía `custom_data.topic` + payload | Se suscribe a `esp32/cmd` | Simple, sin esperar respuesta |
| **B. ReadOnce (ESP → API)** | ESP32 → Broker → API | `GET /api/esp32/status` se conecta, suscribe `esp32/status`, lee 1 mensaje con timeout | Publica periódicamente | Bloqueante; requiere `timeoutMs` (como `hiveDriver` con `worker_threads`) |
| **C. Hybrid / Worker** | Bidireccional | Endpoint inicia cliente MQTT en `node:worker_threads`; publica y lee | Suscribe + publica | Complejo, requiere `mqttFunction` + `mqtt-worker.js` (como `hive-worker.js`) |

**Ejemplo de `custom_data` (Patrón A):**
```json
{
  "brokerUrl": "mqtt://broker.local:1883",
  "username": "${_VAR_MQTT_USER}",
  "password": "${_VAR_MQTT_PASSWORD}",
  "topic": "esp32/cmd",
  "action": "publish",
  "qos": 1,
  "clientId": "openfusion-api-01"
}
```

**Flujo concreto (Patrón A):**
1. Cliente hace `POST /api/esp32/cmd` con cuerpo JSON `{ "relay": 1 }`
2. `mqttFunction` lee `method.custom_data`, resuelve `$_VAR_*` vía `getAppVarContext` (`utils.js:344`)
3. Crea `mqtt.connect(...)` (paquete `mqtt` en `dependencies`)
4. Publica `{ relay: 1 }` a `esp32/cmd`
5. Responde `200 { status: "published", messageId }`
6. ESP32 (en `loop` con `PubSubClient`) recibe y actúa

**Flujo concreto (Patrón B):**
1. Cliente hace `GET /api/esp32/status`
2. Handler se conecta al broker, suscribe `esp32/status`
3. Espera mensaje con `timeoutMs` (ej. `3000`)
4. Si llega, retorna `200 { temp: 23.5, rssi: -42 }`
5. Si no llega, `504 Timeout` (como `hiveDriver` línea 186)

---

## 3. Impacto en el proyecto

### 3.1 Archivos que se tocarían (verificado con `ls src/lib/handler/`)

- **Nuevo:** `src/lib/handler/mqttFunction.js` (o `mqtt.js`)
- **Modificado:** `src/lib/handler/handler.js` (import + `Handlers.MQTT`)
- **Opcional:** `src/lib/handler/mqtt-worker.js` (si se quiere aislamiento como `hive-worker.js` para no bloquear el event loop al esperar mensaje)
- **Nuevo docs:** `src/docs/handlers/MQTT/README.md`, `manifest.json`, `AI_SKILL.md`
- **Demo (opcional):** `src/lib/db/default/demo.js` para crear endpoint de ejemplo
- **GUI (exterior):** repo `libOpenFusionAPIGUI`, archivo `editor.svelte` / `HANDLER_TABS`
- **Dependencia:** agregar `"mqtt": "^5.0.0"` (o `^4.3.7`) a `package.json`

### 3.2 Impacto técnico

| Área | Impacto | Detalle |
|------|---------|---------|
| **DB / Schema** | Ninguno | Usa `Endpoint.custom_data` existente (`jsonField` en `models.js:832`) |
| **Servidor** | Medio | Nuevo cliente TCP (MQTT) por endpoint; si hay 50 endpoints = 50 conexiones a broker. Requiere **pool o singleton** por broker URL.
| **Event loop** | Alto si no se aísla | Si el endpoint espera mensaje (`subscribe` + `await`), bloquea la petición. Solución: `node:worker_threads` como `hiveDriver`. |
| **Memoria** | Medio | Cliente MQTT mantiene socket abierto; al terminar petición debe hacer `client.end()` para liberar. |
| **Seguridad** | Medio | Credenciales en `custom_data` / AppVars (mismo riesgo que `HIVE_DRIVER`). Usar `mqtts://` + TLS. |
| **Docs / IA** | Medio | `npm run docs:handlers` valida `README.md` + `AI_SKILL.md` + `manifest.json`; debe crearse el directorio. |
| **GUI** | Medio | Requiere actualización en proyecto hermano (`libOpenFusionAPIGUI`); sin eso el usuario no verá `MQTT` en el dropdown de handlers. |

---

## 4. Ventajas

- **ESP32 nativo:** `PubSubClient` es el cliente MQTT más usado en ESP32; no requiere HTTP ni JSON parsing complejo en el microcontrolador.
- **Pub/Sub real:** ESP32 puede publicar sensor de temperatura sin que el API lo pregunte (Patrón B con `subscribe` es posible con timeout).
- **Desacoplado:** ESP32 y API no necesitan IP fija ni NAT; solo comparten broker (puede ser `mosquitto` local o `broker.hivemq.com`).
- **Reutiliza infraestructura:** Usa `AppVars` (`$_VAR_MQTT_BROKER`) para no exponer credenciales en código; igual a `$_VAR_HIVE_CONFIG`.
- **No requiere cambio de DB:** El endpoint se configura igual (`handler: "MQTT"`, `code: ""`, `custom_data: {...}`).
- **Complementa WebSocket:** El proyecto ya tiene `WebSocketManager` (`src/lib/server/websocket_manager.js`) para clientes web; MQTT es el equivalente para IoT/ESP32.

---

## 5. Desventajas y riesgos

- **No es request/response puro:** MQTT es asíncrono. El framework (`runHandler`) espera `await handler.fn(...)` y luego `reply.send()`. Si el ESP32 no publica a tiempo, la petición se cuelga o hace timeout.
- **Bloqueo de event loop:** Si no se usa `worker_threads`, un `subscribe` con `await message` congela el servidor para todos los clientes mientras espera. `hiveDriver` resuelve esto con `hive-worker.js`; habría que replicarlo (`mqtt-worker.js`).
- **Conexiones persistentes:** Cada endpoint podría crear un cliente MQTT. Si un usuario crea 100 endpoints con `brokerUrl: "mqtt://..."`, se abren 100 sockets TCP al broker. Hay que implementar **cache de conexiones por broker** (como `ConnectionPool.js` o `customFunction` con singleton).
- **No garantiza entrega:** MQTT QoS 0/1/2; el endpoint debe manejar `messageId` o no esperar confirmación si solo publica.
- **Seguridad:** Sin TLS (`mqtts://`) las credenciales viajan en texto. El proyecto ya soporta TLS en `hiveDriver` (`useTLS`, `tls`); se debe replicar.
- **GUI externo:** Si no se actualiza `libOpenFusionAPIGUI`, el handler no aparece en la interfaz de creación de endpoints.
- **Manejo de errores:** `TimeoutError`, `ECONNREFUSED`, `EPIPE` (como se documenta en `AI_SKILL.md` de HIVE_DRIVER) deben definirse para MQTT.

---

## 6. Implementación recomendada paso a paso

### Paso 1 — Dependencia
```json
"mqtt": "^5.0.3"
```

### Paso 2 — Handler básico (`mqttFunction.js`)
```javascript
import mqtt from 'mqtt';
import { getHandlerExecutionContext, parseJsonConfig, resolveAppVarPlaceholder, sendHandlerResponse, sendHandlerError, getAppVarContext } from './utils.js';

export const mqttFunction = async (context) => {
  const { request, reply, method } = getHandlerExecutionContext(context);
  const { appVars, environment } = getAppVarContext(method);
  let custom_data = method.custom_data || {};
  custom_data = resolveAppVarPlaceholder(custom_data, appVars, environment);
  const config = parseJsonConfig(custom_data);

  if (config.action === 'publish') {
    const client = mqtt.connect(config.brokerUrl, { clientId: config.clientId, username: config.username, password: config.password });
    const payload = request.body || {};
    await new Promise((res, rej) => {
      client.on('connect', () => {
        client.publish(config.topic, JSON.stringify(payload), { qos: config.qos || 1 }, (err) => {
          client.end();
          if (err) rej(err); else res();
        });
      });
      client.on('error', rej);
    });
    sendHandlerResponse(reply, { statusCode: 200, data: { published: true, topic: config.topic } });
  }
  // ... subscribe con timeout si se requiere
};
```

### Paso 3 — Registro en `handler.js`
```javascript
import { mqttFunction } from "./mqttFunction.js";
export const Handlers = {
  // ...
  MQTT: {
    label: "MQTT",
    fn: mqttFunction,
    css_icon: "fa-solid fa-network-wired",
    css_class: "primary",
    description: "Publish or subscribe to MQTT topics (ESP32 / IoT integration).",
  },
};
```

### Paso 4 — Aislamiento con `mqtt-worker.js` (recomendado para `subscribe`)
- Replicar `hive-worker.js`: recibir `brokerUrl`, `topic`, `timeoutMs`; conectar; esperar mensaje; retornar; `terminate()` después de timeout.
- Registrar en `mqttFunction.js` con `new Worker(...)` como `hiveDriver.js:174`.

### Paso 5 — Configuración de ESP32 (ejemplo)
```cpp
#include <PubSubClient.h>
PubSubClient client(brokerServer, 1883, wifiClient);
client.subscribe("esp32/status");
client.publish("esp32/status", "{\"temp\":23.5}");
```

---

## 7. Comparación con alternativas ya existentes en el proyecto

| Alternativa | Estado en repo | Cuándo usarla vs MQTT |
|-------------|---------------|----------------------|
| **WebSocket** (`/ws/*`) | Activo (`websocket_manager.js`) | Cliente web necesita push en tiempo real; ESP32 necesita HTTP/websocket client, que es más pesado que MQTT |
| **FETCH** | Activo (`fetchFunction.js`) | ESP32 hace HTTP a otro servicio; no resuelve pub/sub ni eventos asíncronos |
| **MCP** | Activo (`mcpFunction.js`) | IA como cliente de herramientas; no para ESP32 |
| **JS handler** | Activo | Se podría escribir `mqtt.connect` dentro de `code`; pero no hay `mqtt` en `modules` de `functionVars`; además no hay manejo de worker ni docs oficiales |

**Veredicto:** MQTT es complementario, no reemplazo. Ideal si el ESP32 debe **publicar sin que el API lo solicite** (Patrón B con timeout) o recibir comandos de forma decoupled (Patrón A).

---

## 8. Conclusiones y recomendación

- **Es viable** y sigue el patrón de `HIVE_DRIVER` (handler + `custom_data` + `AppVars` + docs + posible `worker_threads`).
- **Impacto controlable** si se limita al Patrón A (`publish` con timeout corto) o Patrón B con `mqtt-worker.js`.
- **No se recomienda** intentar streaming continuo (SSE / MQTT persistente por endpoint) sin una arquitectura de **background worker** o **WebSocket bridge**; el framework no está diseñado para conexiones persistentes de cliente como broker MQTT.
- **Para ESP32:** MQTT es la mejor opción porque `PubSubClient` es nativo y ligero; usar `MQTT` como handler en `libOpenFusionAPI` permite que el ESP32 sea **emisor y receptor** sin que el micro tenga que implementar un servidor HTTP.

---

## 9. Referencias en el código (rutas exactas verificados)

- Registro de handlers: `src/lib/handler/handler.js` (líneas 16-105)
- Ejemplo de handler con `custom_data` y `AppVars`: `src/lib/handler/hiveDriver.js` (líneas 40-50, 78-92, 159-193)
- Ejemplo de `worker_threads`: `src/lib/handler/hive-worker.js`, llamado desde `hiveDriver.js:174`
- Resolución de variables: `src/lib/handler/utils.js` (`resolveAppVarPlaceholder`, líneas 360-406; `getAppVarContext`, 344-359)
- Modelo endpoint / `custom_data`: `src/lib/db/models.js` (líneas 670-879; `custom_data` en 832)
- WebSocket existente: `src/lib/server/websocket_manager.js` (líneas 138-214)
- Docs handler: `src/lib/server/handlerDocs.js` (líneas 10-11, 42-97), `src/docs/handlers/HIVE_DRIVER/`
- GUI hermano (referenciado): `AGENTS.md` línea 29 (`libOpenFusionAPIGUI`)
- Versión / módulo: `package.json` líneas 3, 31 (`"type": "module"`)
- Dependencias actuales (sin MQTT): líneas 54-111 de `package.json`

---
*Fin del informe.*
