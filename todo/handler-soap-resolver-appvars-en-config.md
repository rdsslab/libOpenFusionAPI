# Handler SOAP: resolver AppVars (`$_VAR_*`) dentro de la configuración JSON

> **ESTADO: implementado** (15 oct 2026, v13.13.0). Código: `resolveAppVarsInConfig`
> en `src/lib/handler/utils.js` + integración en `soapFunction.js`. Tests:
> `dev/test/soap_config_appvars_test.js` (16/16, registrado en `dev/test/index.js`).
> Documentación: `src/docs/handlers/SOAP/README.md` y `AI_SKILL.md`. CHANGELOG 13.13.0.
> **Pendiente antes de desplegar:** auditoría de las AppVars de los 13 endpoints SOAP
> de la app `sap` (sección 6) y prueba de integración con el piloto I21 en dev (sección 7).
>
> Plan de implementación basado en el informe "Handler SOAP: resolver variables de
> aplicación dentro de la configuración" (@Edwin De La Cruz, 15 oct 2026), revisado
> y verificado contra el código real. Decisión de aprobación: el cambio se aprueba
> **condicionado** a que la resolución dentro de la configuración solo reconozca
> nombres con el prefijo completo `$_VAR_`, nunca un simple `$_`.

---

## 1. Regla central (condición de aprobación)

Los nombres de AppVar **siempre** comienzan por `$_VAR_`, no solo por `$_`.

- Se usa `APPVAR_NAME_REGEX = /^\$_VAR_[A-Z0-9_]+$/` de `src/lib/db/appvarName.js`
  para decidir qué valores string se reemplazan dentro de la configuración.
- Un valor como `"$_ALGO"` o `"$_foo"` **no se resuelve**: queda como texto literal.
  (En la práctica no debería existir — el guardado de AppVars ya valida el prefijo
  completo — pero si existiera, no debe romper el request silenciosamente ni con un
  400 espurio: se deja tal cual, como hoy.)
- Esto es estrictamente más seguro que el chequeo suelto `startsWith("$_")` que usa
  el runtime de una sola variable, y es consistente con la convención del repo
  (ver comentario de `appvarName.js`: los nombres se inyectan como globals en el
  sandbox JS y solo son alcanzables directamente si cumplen el formato canónico).

## 2. Alcance del cambio

| Archivo | Cambio |
|---|---|
| `src/lib/handler/utils.js` | Nueva función `resolveAppVarsInConfig(config, appVars, environment)` (~30 líneas), exportada junto a `resolveAppVarPlaceholder`. |
| `src/lib/handler/soapFunction.js` | 1 línea: aplicar la función a `SOAPParameters` antes del merge con el body. Mover `getAppVarContext(endpoint)` fuera del `else` para que también aplique a `custom_data`. |
| `src/docs/handlers/SOAP/README.md` | Documentar el caso de variables dentro del JSON (sección Endpoint Configuration), con el ejemplo de `BasicAuthSecurity`. |
| `CHANGELOG.md` | Entrada con el cambio y nota de compatibilidad. |
| `dev/test/soap_config_appvars_test.js` | Nuevo test unitario, registrado en `dev/test/index.js`. |

No se toca ningún otro handler (SQL, HANA, MongoDB, FETCH, TEXT, bots): la función
queda genérica para extenderlo después en un cambio aparte.

## 3. Especificación de `resolveAppVarsInConfig`

```js
import { APPVAR_NAME_REGEX } from "../db/appvarName.js";

export const resolveAppVarsInConfig = (config, appVars, environment = "dev") => {
  const walk = (value) => {
    if (typeof value === "string") {
      return APPVAR_NAME_REGEX.test(value.trim())
        ? resolveAppVarPlaceholder(value, appVars, environment) // no se vuelve a recorrer
        : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(config);
};
```

Reglas (las 7 del informe, más la regla `$_VAR_` de arriba):

1. **Qué se reemplaza:** string cuyo valor recortado cumple `APPVAR_NAME_REGEX`
   (prefijo completo `$_VAR_`). `"Basic $_VAR_X"`, `"http://$_VAR_X/..."` y
   `"$_ALGO"` no se tocan.
2. **Qué se recorre:** objetos y arreglos a cualquier profundidad. Solo valores,
   no claves.
3. **Tipo del resultado:** se inserta tal como lo devuelve `resolveAppVar`
   (si el valor de la variable es JSON, se inserta el objeto ya parseado).
4. **Sin resolución en cadena:** el valor insertado no se vuelve a recorrer
   (evita ciclos y dependencias ocultas entre variables).
5. **Variable inexistente:** error 400 con el mensaje existente
   (`AppVar $_VAR_X not found for environment dev`). Nunca se incluye ningún
   valor en el error.
6. **Solo la configuración:** se resuelve antes de `mergeObjects` con el body.
   Los valores que manda el llamador (`RequestArgs`, body) jamás se resuelven.
7. **Ambas fuentes:** aplica a la configuración del `code` **y** a `custom_data`.
8. **Inmutable:** devuelve copia; no muta el objeto recibido (`custom_data` es el
   objeto del endpoint en memoria, reutilizado entre requests). De paso corrige la
   mutación actual de `SOAPParameters.RequestArgs` en GET (`soapFunction.js:234`).

`appvarName.js` no tiene imports → no hay dependencia circular.

## 4. Integración en `soapFunction.js`

En el bloque de las líneas 200–224:

1. Sacar `const { appVars, environment } = getAppVarContext(endpoint);` fuera del
   `else` (antes solo existía en la rama del `code`).
2. Tras resolver/parsear la configuración (ambas ramas), antes de la línea 227:

```js
SOAPParameters = resolveAppVarsInConfig(SOAPParameters, appVars, environment);
```

3. **Orden respecto a `mergeObjects` (líneas 238–239):** la resolución debe quedar
   **antes**, para no tocar valores del body (regla 6).

Flujo resultante:

```
custom_data.wsdl existe? ──sí──> SOAPParameters = custom_data ─┐
                                  no: code → resolveAppVar    │
                                       → parseJsonConfig ──────┤
                                                               ▼
                                  SOAPParameters = resolveAppVarsInConfig(...)
                                                               ▼
                                  merge query/body + SOAPParameters (como hoy)
```

Nota: la rama del `code` resuelve el placeholder de una sola variable con el
chequeo suelto `$_` que ya existía. Eso se mantiene igual por compatibilidad
(un `code` = `$_VAR_WSDL_...` sigue funcionando igual que hoy); la condición
estricta `$_VAR_` aplica a la resolución **dentro** de la configuración, que es
lo nuevo.

## 5. Compatibilidad

- Un `code` que es una sola AppVar (`$_VAR_WSDL_SI_...`) se resuelve igual que
  hoy; después se recorre su contenido, que normalmente no tiene placeholders.
- Las cuatro formas de `app_vars` que soporta `resolveAppVar` siguen funcionando
  (se reutiliza esa función).
- El caché de clientes SOAP (`getSoapClient`) usa como clave el WSDL + opciones,
  que incluyen la cabecera `Authorization` ya resuelta: al rotar la clave se
  crea un cliente nuevo automáticamente.

## 6. Riesgos y mitigación (previo al despliegue)

| Riesgo | Mitigación |
|---|---|
| Un SOAP existente referencia una variable cuyo valor sea exactamente otro `$_VAR_ALGO`: antes iba literal, ahora se resuelve o da 400. | **Auditar antes de desplegar** los valores de las AppVars referenciadas por los 13 endpoints SOAP de la app `sap` (dev/qa/prd). También verificar que todos los nombres referenciados cumplan `$_VAR_[A-Z0-9_]+`. |
| Un llamador envía `"$_VAR_X"` en el body para que el servidor lo reemplace. | Regla 6 (solo se resuelve la configuración, antes del merge). Cubierto por test. |
| Un error expone el valor de una variable. | Los errores solo nombran la variable. Cubierto por test. |

## 7. Pruebas

Nuevo archivo `dev/test/soap_config_appvars_test.js`, registrado en
`dev/test/index.js` para que corra con `npm test`. Casos:

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Objeto anidado | `{"BasicAuthSecurity":"$_VAR_AUTH"}` | `BasicAuthSecurity` es el objeto `{User, Password}` |
| Arreglo | `{"a":["$_VAR_X","texto"]}` | Primer elemento resuelto, segundo intacto |
| Texto parcial | `{"url":"http://$_VAR_HOST/x"}` | Sin cambios |
| **Nombre sin prefijo completo** | `{"k":"$_ALGO"}` | **Sin cambios (literal)** — regla `$_VAR_` |
| Espacios | `{"k":" $_VAR_X "}` | Resuelto |
| Variable inexistente | `{"k":"$_VAR_NO_EXISTE"}` | Error 400 que nombra la variable y no incluye valores |
| Sin resolución en cadena | `$_VAR_A` cuyo valor contiene `"$_VAR_B"` | Queda el texto `"$_VAR_B"` |
| No muta | Objeto de entrada | El objeto original no cambia |
| Ambientes | Misma variable en dev y prd | Toma el valor del ambiente del endpoint |
| Body no se resuelve | `RequestArgs: {"x":"$_VAR_AUTH"}` en el request | Se envía literal al servicio SOAP |

Prueba de integración con el piloto I21 (dev):

1. Crear `$_VAR_SAP_PO_AUTH` en dev.
2. Cambiar el `code` de `/sap/validacupocliente` a JSON en línea con
   `"BasicAuthSecurity": "$_VAR_SAP_PO_AUTH"`.
3. `{"describe()": true}` devuelve la operación `SI_Validacupocliente_Sync_Out`.
4. Consulta cliente 0011002883 / Z001 → HTTP 200, código `Z01`.
5. Los demás endpoints SOAP existentes responden igual que antes.

Criterio de aceptación: `npm test` verde + piloto I21 responde igual con la
variable compartida.

## 8. Orden de ejecución

1. `resolveAppVarsInConfig` en `utils.js` (con la validación `$_VAR_`).
2. Integración en `soapFunction.js` (mover `getAppVarContext`, aplicar antes del
   merge).
3. Tests unitarios en `dev/test/` + registro en `dev/test/index.js`. Ejecutar `npm test`.
4. Auditoría de las AppVars de los 13 endpoints SOAP existentes (previo a despliegue).
5. Documentación del handler SOAP + `CHANGELOG.md`.
6. Despliegue a dev y prueba de integración I21.

## 9. Fuera de alcance (registrar como tareas separadas)

- Interpolación dentro de textos (`"http://$_VAR_PO_HOST:51000/..."`): requiere
  definir sintaxis y escape. Útil para que el host cambie por ambiente.
- Extender la resolución a otros handlers (SQL `custom_data`, HANA, MongoDB,
  FETCH): la función queda genérica y lista; hacerlo en un cambio aparte.
- **Seguridad de logs:** los logs nivel 3 guardan `params.app_vars` con todos los
  valores, incluidas claves (visible en la traza del piloto I21). No lo causa este
  cambio, pero es una fuga de credenciales: tratarlo aparte y con prioridad.
