# Implementación: entornos en /linkapp y /unlinkapp (+ fix /apistats)

Fecha: 2026-09-24. Estado: **código listo, pendiente despliegue y verificación en vivo**.

## Problema original

`/apistats` reportaba 0/0 para `diary-bot` porque el vínculo del chat
`-1004310153932` quedó con `"environment":"prd"`, pero toda la app (14 endpoints,
bot, tráfico) vive en `dev`. Además, `/linkapp` vinculaba siempre con `prd`
(`ENV` hardcodeado) y `writeAppGroupLink` conservaba el entorno previo
(`current.environment || environment`), ignorando un entorno nuevo explícito.

## Cambios realizados (sin desplegar aún)

| Archivo | Cambio |
|---|---|
| `src/lib/db/app.js` | `getAppsCatalog` ahora incluye `environments: string[]` por app (entornos de endpoints **habilitados**, orden dev→qa→prd, 1 consulta agregada sobre `Endpoint`). |
| `src/lib/server/functions/system/prd/appgroups/groupLinks.js` | `writeAppGroupLink`: `environment: environment ?? current.environment ?? ENV` — un entorno explícito siempre se aplica; sin entorno se conserva el previo o usa ENV. |
| `src/lib/server/functions/system/prd/appgroups/index.js` | `fnAppGroupLinkWrite` pasa `body.environment` normalizado (trim; ""/undefined ⇒ la capa DB decide). |
| `src/lib/server/functions/system/prd/user/systemBot.telegram.js` | Nuevo flujo `/linkapp` en 2 pasos (app → entorno) con botones; confirmación al **cambiar** el entorno de una app ya vinculada; aviso para apps sin endpoints habilitados; `/unlinkapp` muestra el entorno; `/status` consulta con `entry.environment \|\| ENV`; `getAppsEnvIndex`; callbacks `appsel:`, `linkapp:<idapp>:<env>`, `linkapp-switch:`, `linkapp-cancel` (compat con `linkapp:<idapp>` legacy). |
| `src/lib/db/default/system.js` | Docs del seed `apps_catalog` mencionan `environments` (documental). |

## Despliegue

1. **Servidor**: reiniciar/redeployar el proceso con los cambios de `db/app.js`,
   `appgroups/*.js` y `default/system.js`. (Opcional: reseed/upsert del endpoint
   `apps_catalog` para reflejar la descripción nueva en el MCP.)
2. **Bot**: publicar el script nuevo con `upsert_bot` para el bot
   **OpenFusionAPI Bot** (`idbot c8d9e0f1-2a3b-4c5d-a6e7-b8c9d0e1f2a3`),
   usando el contenido de `systemBot.telegram.js` como `ofapi_bot.code`.

## Verificación

1. MCP `apps_catalog` → cada app debe traer `environments` (diary-bot ⇒ `["dev"]`,
   demo ⇒ `["dev"]`, system ⇒ `["prd"]`).
2. En el grupo: `/linkapp` → botones de app; elegir `diary-bot` → botón `dev`; un clic vincula.
3. `/apistats` → debe mostrar **19 requests / 14 endpoints** (entorno dev).
4. `/status` → cabecera con `· dev` y datos reales.
5. `/unlinkapp` → lista `diary-bot — dev`; desvincula (y volver a vincular para no dejar el grupo suelto).
6. Regresión: `/linkapp demo` (1 entorno, directo), `/linkapp diary-bot dev`
   (sintaxis nombre+entorno), respuestas numéricas por texto, callbacks antiguos
   (`linkapp:<uuid>`) no rompen.

## Remediación del dato legacy (diary-bot)

El vínculo actual del chat `-1004310153932` quedó en `environment: "prd"`.
Two opciones (se eligió re-vincular con el nuevo picker):

- **A (recomendado)**: tras publicar el bot, un admin re-vincula el grupo con el
  nuevo selector eligiendo `diary-bot — dev` (valida el flujo nuevo y corrige el dato).
- **B (directo)**: con `appvar_upsert`, en `diary-bot`
  (`idapp 7986d92e-f15b-44bf-8bc0-7347b8790c55`), var `$_VAR_TELEGRAM_GROUPS`
  (fila `prd` — `findGroupsVar` solo lee `prd`), cambiar el JSON a:
  `{"-1004310153932":{"environment":"dev","linked_by":"superopenfusionapi","linked_at":"2026-09-24T12:58:14.767Z"}}`.

## Notas técnicas

- La AppVar `$_VAR_TELEGRAM_GROUPS` debe seguir en la fila de entorno `prd`; el
  entorno útil viaja dentro del JSON (`entry.environment`). `readAppGroupLinks`
  (groupLinks.js) solo lee filas `prd`.
- Modelo de datos: **1 entorno por app por grupo**. Re-vincular la misma app en
  otro entorno **cambia** el vínculo (con confirmación), no agrega un segundo vínculo.
- `callback_data` dentro del límite (48 bytes) y máx. 100 botones por mensaje
  (picker acotado por `MAX_PICKER`).