# Ejecutar transacciones de SAP desde Node.js

> Documento de trabajo para retomar la idea más adelante.
> Resumen de todo lo conversado y revisado hasta ahora: cómo ejecutar
> transacciones de SAP (lecturas y acciones) desde Node.js, sin SDKs propietarios.
>
> **Seguridad:** este documento NO contiene IPs reales ni credenciales. Se usan
> placeholders (`<qa-host>`, `<usuario-QA>`, `<password-QA>`, `<client>`, ...).
> Cualquier dato real (WSDL, usuario, contraseña) debe vivir fuera del repo
> (p. ej. en `temporales/`, que está en `.gitignore`).

---

## 1. Objetivo

Desde una API Node.js (openfusionapi, que puede correr en un contenedor Linux),
poder **leer** datos de SAP y **ejecutar acciones** en SAP (p. ej. contabilizar
una factura, procesar transacciones `Z`), con **respuesta síncrona**.

Datos de prueba de referencia (de ejemplo, sin datos reales de clientes):
- Cliente: `10000000` — "CLIENTE EJEMPLO"
- Sociedad: `1000`
- Rango de fechas: `20220101` – `20221231`

---

## 2. Estado del análisis (decisiones ya tomadas)

| Tema | Conclusión |
|---|---|
| RFC / SDK | `node-rfc` (SAP) **descartado**: paquete npm deprecado (última 3.3.1) y requiere el SDK SAP NW RFC (cuenta S-user/partner difícil de obtener). |
| Cloud vs on-prem | El sistema es **SAP on-prem** (ECC/S4). S/4HANA Cloud no soporta RFC. |
| GUI Scripting | **Descartado**: depende de SAP GUI en Windows con macro/VBS; no sirve en Docker ni del lado servidor. |
| BDC / batch input | **Vía principal para acciones**: controlar la transacción "pulsando pantallas" desde código. |
| Transacciones `Z` | Hechas por **consultores externos** → sin BAPI ni detalle técnico; se abren con **pantallas** (territorio BDC). Ejemplo: `ZFBL5N`. |
| Recursos del usuario | Tiene **SE80** (crea FMs y publica Web Services), usuario funcional QA, acceso **HANA directo ya funcionando** para consultas, y red hacia el puerto HTTP de SAP. |
| Sincronía | Las respuestas de las acciones deben ser **síncronas** (`CALL TRANSACTION ... MODE 'N' UPDATE 'S'`). |

**Caso de lectura (FBL5N).** El guion inicial fue exponer partidas de cliente
entre fechas (BSID/BSAD) vía FM + Web Service SOAP. Tras confirmar que hay HANA
directo, la recomendación es usar **HANA directo para las lecturas** (sección 3)
y reservar el patrón FM/Web Service para las acciones (sección 4).

---

## 3. Capa de LECTURAS → HANA directo

Ya funcionando desde openfusionapi. Para "partidas de cliente entre fechas",
equivalente a FBL5N:

- Tablas: `BSID` (partidas abiertas) + `BSAD` (partidas saldadas).
- Filtros: mandante (`MANDT`), sociedad (`BUKRS`), cliente (`KUNNR`), **sin
  operaciones especiales** (`UMSKZ = ' '`), fecha de contabilización
  (`BUDAT`) entre desde/hasta.
- Orden estilo lista: `BUDAT, BELNR, BUZEI`.
- Importes: `DMBTR` (moneda local) y `WRBTR` (moneda documento) + `WAERS`.

SQL de referencia:

```sql
SELECT BELNR, BUZEI, GJAHR, BLART, BUDAT, BLDAT, SHKZG,
       CASE WHEN SHKZG = 'H' THEN -1 * DMBTR ELSE DMBTR END AS DMBTR_VISTA,
       WRBTR, WAERS, XBLNR, ZUONR, SGTXT
  FROM BSID                                -- abiertas
 WHERE MANDT = '<client>'
   AND BUKRS = '<sociedad>'
   AND KUNNR = '<cliente>'
   AND UMSKZ = '        '                  -- sin operaciones especiales
   AND BUDAT BETWEEN '<YYYYMMDD_desde>' AND '<YYYYMMDD_hasta>'
UNION ALL
SELECT BELNR, BUZEI, GJAHR, BLART, BUDAT, BLDAT, SHKZG,
       CASE WHEN SHKZG = 'H' THEN -1 * DMBTR ELSE DMBTR END AS DMBTR_VISTA,
       WRBTR, WAERS, XBLNR, ZUONR, SGTXT
  FROM BSAD                                -- saldadas
 WHERE MANDT = '<client>'
   AND BUKRS = '<sociedad>'
   AND KUNNR = '<cliente>'
   AND UMSKZ = '        '
   AND BUDAT BETWEEN '<YYYYMMDD_desde>' AND '<YYYYMMDD_hasta>'
 ORDER BY BUDAT, BELNR, BUZEI;
```

Notas:
- `SHKZG = 'H'` (haber/crédito) se muestra negado en la GUI; el `CASE` replica
  ese comportamiento. Ajustar según el criterio de presentación deseado.
- En lectura directa la **semántica de FBL5N se replica y se mantiene aquí**
  (abierta/saldada, operaciones especiales, redondeo). Para volúmenes masivos o
  agregados, preferir CDS views (OData) antes que SQL crudo.
- El PoC FM/SOAP de lectura queda como **Plan B** si algún día se necesita
  semántica exacta de pantalla o autorizaciones de rol SAP (ver referencia §6).

---

## 4. Capa de ACCIONES → BDC síncrono vía Web Service

**HANA directo NO es opción para escribir**: saltar la capa de aplicación rompe
numeración de documentos, controles de mayor, autorizaciones, logs e integridad.
SAP no lo soporta.

Sin BAPIs (transacciones Z de consultores sin detalle), el estándar es **BDC**,
con **posteo síncrono**: `CALL TRANSACTION` dentro de un FM remoto.

### Material necesario para armar el BDC de cada acción

- **Recorrido de pantallas**: grabación con **SHDB** (batch input recorder) o
  nombres técnicos desde F1/SE11. Cada paso es `PROGRAM + DYNPRO + OKCODE` y una
  sucesión de pares `FNAM/FVAL` (campos de pantalla).
- El **usuario funcional** define el recorrido; el **código ABAP** lo escribe
  quien tenga SE37 (plantillas abajo).

### Patrón A — un FM por transacción (recomendado si hay pocos TCODE y se quiere máximo control)

```abap
FUNCTION z_<tcode>_post.
*"----------------------------------------------------------------------
*" Importing: IV_<PARAM>  (parámetros de negocio de la acción)
*" Tables   : ET_RETURN TYPE BAPIRET2_T
*"----------------------------------------------------------------------
  DATA: lt_bdcdta  TYPE TABLE OF bdcdata,
        lt_mess    LIKE bdcmsgcoll.

* Construir el recorrido de pantallas (ej.: datos de cabecera/partidas)
  PERFORM fill_bdc USING 'SAPM<XXXX>' '0100' ''          CHANGING lt_bdcdta.
  PERFORM fill_bdc USING '' '' 'ONLI'                    CHANGING lt_bdcdta.
  PERFORM fill_bdc USING 'SAPM<XXXX>' '0100' 'BSCH'      CHANGING lt_bdcdta.
  PERFORM fill_bdc USING 'RF05A-NEWBS' '40' ''           CHANGING lt_bdcdta.
* ... (los campos reales salen de la grabación SHDB)

  CALL TRANSACTION '<TCODE>'
        USING  lt_bdcdta
        MODE   'N'
        UPDATE 'S'
        MESSAGES INTO lt_mess.

* Convertir lt_mess a ET_RETURN (TYPE BAPIRET2_T) y salir con EV_SUBRC.
ENDFUNCTION.
```

### Patrón B — ejecutor BDC genérico (recomendado; un solo WS para todo)

```abap
FUNCTION z_bdc_call.
*"----------------------------------------------------------------------
*" Importing: IV_TCODE      TYPE TCODE
*"            IV_UPDATE_MODE TYPE C DEFAULT 'S'   " S síncrono / A asíncrono
*" Tables   : IT_BDCDATA  TYPE STANDARD TABLE OF BDCDATA
*"            ET_MESSAGES TYPE BAPIRET2_T
*" Exporting: EV_SUBRC TYPE SYST_SUBRC
*"----------------------------------------------------------------------
  DATA: lt_mess TYPE TABLE OF bdcmsgcoll,
        ls_ret  LIKE LINE OF et_messages.

* Autorización: whitelist de TCODEs y de usuarios (mínima seguridad)
  AUTHORITY-CHECK OBJECT 'S_TCODE' ID 'TCD' FIELD iv_tcode.
  IF sy-subrc <> 0.
    ls_ret-type = 'E'.  ls_ret-id = 'Z1'.  ls_ret-number = '001'.
    ls_ret-message = |Sin autorización para la transacción { iv_tcode }.|.
    APPEND ls_ret TO et_messages.
    RETURN.
  ENDIF.

  DATA(lv_update) = SWITCH c( iv_update_mode WHEN 'S' THEN 'S'
                                             WHEN 'A' THEN 'A'
                                             WHEN 'L' THEN 'L'
                                             ELSE 'S' ).

  CALL TRANSACTION iv_tcode
        USING  it_bdcdta
        MODE   'N'
        UPDATE lv_update
        MESSAGES INTO lt_mess.

  ev_subrc = sy-subrc.

* Convertir mensajes BDC (BDCMSGCOLL) a BAPIRET2_T
  LOOP AT lt_mess INTO DATA(wa).
    DATA(w_msgtyp) = SWITCH c( wa-msgtyp WHEN 'E' THEN 'E'
                                         WHEN 'W' THEN 'W'
                                         WHEN 'A' THEN 'A'
                                         WHEN 'I' THEN 'I'
                                         ELSE 'S' ).
    MESSAGE ID wa-msgid TYPE w_msgtyp NUMBER wa-msgnr
            WITH wa-msgv1 wa-msgv2 wa-msgv3 wa-msgv4 INTO ls_ret-message.
    ls_ret-type   = w_msgtyp.
    ls_ret-id     = wa-msgid.
    ls_ret-number = wa-msgnr.
    APPEND ls_ret TO et_messages.  CLEAR ls_ret.
  ENDLOOP.
ENDFUNCTION.
```

### Comparativa de patrones

| Criterio | Patrón A (FM por transacción) | Patrón B (genérico `Z_BDC_CALL`) |
|---|---|---|
| Objetos SAP | 1 WS por acción | Un solo FM/WS |
| Control de parámetros | A medida, más seguro | Node compone el BDC (payload flexible) |
| Dependencia del código Z | Ninguna (solo recorrido de pantallas) | Ninguna |
| Seguridad | Fácil (superficie por acción) | Requiere **whitelist TCODE/usuarios** |
| Mantenimiento | N objetos | 1 objeto, layouts frágiles igual que A |
| **Recomendación** | Solo si hay pocas acciones | **✔ Preferido** (no controlan el código Z y de todos modos se hace BDC) |

> Si las acciones comparten posteo estándar (p. ej. FI), evaluar también BAPIs
> estándar de SAP (BAPI *ACC*... para documentos contables) que ya son
> síncronas y sin BDC.

---

## 5. Publicar el Web Service en SAP (proceso común)

1. **SE37**: crear FM → marcar **"Procesamiento remoto"** (Remote-Enabled).
2. **Publicar**: SE80 (botón derecho sobre el FM → *Web Service → Create*) o
   `SOAMANAGER` (*Service Providers*).
3. **SICF**: activar `/sap/bc/srt` y el nodo del servicio (estado verde).
4. **Autenticación**: en el servicio, método **"User ID/Password"** (habilita
   HTTP Basic contra el logon SAP); también configurar el *Logon Data* del nodo
   (mandante `<client>`).
5. **WSDL** (URL de referencia con placeholders, **sin IPs/credenciales**):
   ```
   http://<qa-host>:8000/sap/bc/srt/wsdl/srvc_ws_<NombreServicio>/wsdl11/allinone/ws_policy/standard?sap-client=<client>
   ```
   La URL exacta se copia desde SE80/SOAMANAGER. Abrirla en el navegador debe
   pedir usuario/contraseña y devolver XML WSDL.

---

## 6. Consumo desde Node (patrón validado)

Dependencia: `soap` (`npm install soap` → v1.12.0).

Quirks importantes de `node-soap` 1.x:
- El modo Promise se monta con sufijo **`Async`**
  (`overridePromiseSuffix` por defecto = `'Async'`). Llamar
  `client.<Metodo>(args)` SIN `Async` no devuelve nada utilizable.
- `<Metodo>Async(args, options)` resuelve `[result, raw, soapHeader, rawReq, mtom]`.
- **`timeout`/`requestTimeout` se ignoran** en `createClient` → envolver con
  `Promise.race` (withTimeout).
- Auth: `client.setSecurity(new soap.BasicAuthSecurity(user, pass))`.

Ejemplo compacto (patrón de `temporales/sap-poc/fbl5n.js`):

```js
const soap = require('soap');

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms)),
  ]);

async function callSap(cfg) {
  const client = await withTimeout(soap.createClientAsync(cfg.wsdl), cfg.timeoutMs, 'WSDL');
  client.setSecurity(new soap.BasicAuthSecurity(cfg.user, cfg.pass));

  const method = client[cfg.methodName + 'Async'];   // sufijo Async (v1.x)
  const [result, /* raw */] = await withTimeout(
    method.call(client, cfg.args, { SOAPAction: `"${cfg.methodName}"` }),
    cfg.timeoutMs, 'llamada SOAP');

  // El body puede venir envuelto como "<Metodo>Response" o directo
  const body = result[cfg.methodName + 'Response'] || result;
  return body;
}
```

Convención de códigos de salida del PoC: `1` config inválida, `2` WSDL/SOAP,
`3` SAP `TYPE=E` en ET_RETURN/ET_MESSAGES, `9` error inesperado. Este patrón
corre en **contenedor Linux** (es HTTP SOAP, no depende de GUI).

---

## 7. Plan por fases

1. **Cerrar lecturas (HANA directo)**: documentar el SQL de §3 como recurso de
   consulta dentro del repo. Decidir si el PoC SOAP de lectura queda como Plan B.
2. **Validar BDC con UNA acción real** (la Z más usada para postear):
   grabar recorrido con SHDB → escribir FM (patrón B, o A si es única) → publicar
   WS → consumir desde openfusionapi de forma síncrona → **verificar nº de
   documento contra GUI**.
3. **Replicar al resto de Z** con el mismo molde una vez validado.

---

## 8. Pendientes / preguntas abiertas

- [ ] ¿Lecturas 100% HANA directo (recomendado) o mantener FM/WS como Plan B?
- [ ] ¿Patrón A (FM por transacción) o B (ejecutor BDC genérico con whitelist)?
      Recomendación: **B**.
- [ ] ¿HAY **SHDB** disponible en QA? ¿Se puede grabar 1 posteo de ejemplo para
      sacar `PROGRAM/DYNPRO/OKCODE/FNAM`? — es el insumo del BDC.
- [ ] ¿Quién escribe el FM ABAP (usuario en SE37 con plantilla, o ABAPer)?
- [ ] Transporte de la service definition si QA no es sistema de desarrollo.
- [ ] Al validar, decidir la integración en openfusionapi (handler SOAP/extensión
      del lado de lecturas HANA existente).

---

## 9. Referencias (archivos fuera del repo / gitignored)

Todo el material completo vive en `temporales/` (**no está en git**):

- `temporales/sap-guia-fbl5n.md` — guía completa: FM de lectura, publicación del
  Web Service, SICF, auth, troubleshooting.
- `temporales/sap-poc/` — PoC Node validado offline (mock SOAP, selftest 5/5):
  `fbl5n.js`, `sapconfig.json` (con credenciales/WSDL reales SOLO localmente),
  `mock/wsdl.xml`, `mock/server.js`, `mock/selftest.js`.

> Regla: no subir IPs, usuarios, contraseñas ni WSDL reales al repositorio.