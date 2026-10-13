# Comentarios en el SQL del handler `SQL` — validación en vivo y correcciones

> Informe de la prueba en vivo del recorte de comentarios introducido en el commit
> `f2f1b81` (`stripNonExecutableComments`), de los hallazgos que produjo y de las
> correcciones aplicadas.

---

## 1. Qué se probó y por qué

El commit `f2f1b81` añadió a `src/lib/handler/utils.js` la función
`stripNonExecutableComments()`, que quita los comentarios **no ejecutables** (`--`, `#`
de MySQL, `/* … */`) del SQL antes de entregárselo a Sequelize, conservando `/*! … */`
y los hints `/*+ … */`. La invoca `ConnectionPool.js` dentro del parche
`QueryConComentariosNeutros.formatBindParameters`, **solo cuando la petición trae
`values`** (binds `$name`).

El objetivo de la prueba era comprobar, contra motores reales, que el recorte hace lo
que promete y **no rompe nada que antes funcionara**. La conclusión es que hacía lo
prometido pero introducía una regresión, agravaba otra y dejaba dos defectos previos sin
resolver. Los cuatro quedan corregidos aquí.

### Motores y builds comparados

Se ejecutó cada caso dos veces, cambiando solo la URL, para aislar el efecto del commit:

| Build | Commit | Puerto | Rol |
|---|---|---:|---|
| **ANTES** | `42bafea` (padre de `f2f1b81`) | 3200 | línea base sin recorte |
| **DESPUÉS** | `f2f1b81` (HEAD) | 3100 | con recorte |

Motores reales en Docker, todos con la base `sqltest` y las tablas `items`/`counters`
sembradas:

| Motor | Dónde | Versión |
|---|---|---|
| PostgreSQL | `127.0.0.1:5432` | imagen local |
| SQL Server | `127.0.0.1:1433` | imagen local |
| MySQL | `127.0.0.1:3306` | `mysql:8.4` |
| MariaDB | `127.0.0.1:3307` | `mariadb:11.4` |
| SQLite | `/tmp/opencode/sqltest.sqlite` | fichero |
| SAP HANA | — | **fuera de alcance** |

> **HANA queda fuera**: `sqlHana.js` no pasa por Sequelize ni por
> `ConnectionPool.formatBindParameters` (usa su propio sustituto), así que el commit no
> lo toca. Su sustituto propio ya ignoraba los `$` de comentarios y literales.

### Arnés

- `comments_matrix.mjs` — matriz de 95 casos × 5 motores (comentarios de línea,
  bloque, multilínea, anidados, dentro de literales/identificadores, ejecutables,
  alrededor de binds, AppVars `$_VAR_…`, apostrofes impares).
- `edge_cases.mjs` — 15 casos límite (fusión de tokens, alcance, `--` en MySQL/MariaDB).
- `extra_cases.mjs` — 6 extras (`#` con doble bind, `/*! */` con bind, `$$` en Postgres).
- `sql_comments_test.js` (en el repo) — 20 casos contra SQL Server real.
- `sql_param_detection_test.js` (en el repo) — suite **pura** del escáner.

---

## 2. Resultados A/B

| Prueba | ANTES (3200) | DESPUÉS sin corregir (3100) | Corregido |
|---|---:|---:|---:|
| `comments_matrix` (95 × 5 motores) | 91/95 | 88/95 | **95/95** |
| `edge_cases` | 13/15 | — | **15/15** |
| `extra_cases` | 2/6 | — | 5/6\* |
| `sql_comments_test` (MSSQL) | — | — | **20/20** |
| `sql_param_detection_test` (pura) | — | — | **107 casos** |

\* El único que sigue fallando es MariaDB con un `$bind` dentro de `/*! … */`; es una
limitación del driver, no del handler (ver §4, H4).

El commit `f2f1b81` **arreglaba 2 casos** (los dos de SQLite que antes devolvían `200 null`)
y **rompía 5** (la fusión de tokens, en los cinco motores). Los 2 de dollar-quoting de
PostgreSQL fallaban antes y después: son defectos previos del camino con `bind`, ajenos al
recorte.

---

## 3. Hallazgos

### H1 · Regresión (alta) — el bloque borrado fusiona los tokens que separaba

Quitar un `/* … */` sin dejar separador pega las palabras que el comentario separaba:

```sql
SELECT id, qty/* nota */FROM items WHERE name <> $name ORDER BY id LIMIT 5
```

se ejecutaba como `… qtyFROM items …` → `Unknown column 'qtyFROM'`. Confirmado con
**HTTP 500 en los cinco motores**.

Detalle que costó verlo: solo ocurre cuando la petición trae binds (`values`), porque el
recorte vive dentro de `formatBindParameters`. Con `:param` (replacements) o sin
parámetros, el comentario llega intacto y la consulta funciona: el mismo SQL que falla
con `?name=…` pasa con `/recurso` sin parámetros. Es la clase de regresión que una
prueba de humo sin binds no ve.

### H2 · Agravamiento (media) — `--` sin espacio en MySQL/MariaDB no es un comentario

En MySQL y MariaDB, `--` **solo** abre comentario si detrás hay un espacio o un carácter
de control. `1--2` es `1 - (-2)` = 3:

```
MySQL   [SELECT 7--1+1] -> 9
MariaDB [SELECT 7--1+1] -> 9
```

El recorte trataba `--` como comentario en todos los motores, así que

```sql
SELECT 1--2 AS x, $name AS eco
```

se recortaba a `SELECT 1`: el endpoint respondía **200 con un resultado equivocado**
(desaparecían `AS x` y `eco`) en lugar del error 500 que daba antes del commit. Un 200
silencioso con datos cambiados es peor que un 500.

### H3 · Defecto previo (media) — dollar-quoting de PostgreSQL

Dos síntomas, misma raíz: la regex de sustitución de bind de Sequelize
(`lib/dialects/abstract/query.js:78`, `sql.replace(/\B\$(\$|\w+)/g, …)`) no distingue un
`$` que abre un cuerpo dollar-quoted del que abre un bind.

- **`$$ … $$`** → la regex convierte `$$` en `$` y PostgreSQL responde
  `syntax error at or near "$"` (500).
- **`$tag$ … $tag$`** → `$tag` se leía como bind y el guard lo rechazaba con
  `SQL_BIND_INSIDE_LITERAL` (400), aunque el cuerpo no tuviera ningún `$nombre`.

```sql
SELECT $$ cuerpo $$ AS txt, $name AS eco   -- 500 antes
SELECT $tag$ cuerpo $tag$ AS t, $name AS eco -- 400 antes
```

### H4 · Defecto previo (baja) — `$bind` dentro de comentarios ejecutables `/*! … */`

`/*! … */` se ejecuta en MySQL/MariaDB, así que un `$name` de dentro es un bind real.
El código lo neutralizaba (insertaba un espacio: `$ name`) y la consulta moría con error
de sintaxis.

```sql
SELECT 1 AS x /*! , $name AS eco */   -- 500 antes, 200 con eco=zzz en MySQL
```

### H5 · Efecto positivo — SQLite y el comentario inicial

Sequelize tiene un atajo para SQLite: si el SQL **empieza** por `-- ` hace
`return resolve()` y lo ejecuta tal cual. Un endpoint que empezaba por `-- comentario`
devolvía `200 null`; al quitar el comentario antes, devuelve filas. El recorte, aquí,
arregla.

---

## 4. Solución aplicada

### `src/lib/handler/utils.js`

1. **`esComentarioDeLinea(query, i, dialecto)`** (nueva). Decide si en `query[i]` empieza
   un comentario `--`. En MySQL/MariaDB exige espacio o control detrás (o fin de
   cadena); en el resto, y sin dialecto, siempre comenta. Se usa en `scanSqlTokens()` y
   en `stripNonExecutableComments()`. → **H2**.

2. **`stripNonExecutableComments()`**: al descartar un `/* … */` no ejecutable deja un
   **espacio**, porque el comentario separaba tokens. → **H1**. Además, `#` se recorta
   también en MariaDB (antes solo en MySQL), y `--` pasa por `esComentarioDeLinea()`.
   → **H2**.

3. **`scanSqlTokens()`**:
   - `--` pasa por `esComentarioDeLinea()`. → **H2**.
   - El contenido de `/*! … */` y `/*+ … */` se anota como **código** en
     MySQL/MariaDB, de modo que un `$name` de dentro es un bind real y no se neutraliza.
     → **H4**.
   - El rango del cuerpo dollar-quoted termina donde **empieza** la etiqueta de cierre
     (antes la incluía y marcaba su propio `$tag` como bind). → **H3**.
   - Cada cuerpo dollar-quoted deja además una **marca de región** con sus offsets, que
     `protegerDollarQuoted()` consume.

4. **`protegerDollarQuoted(query, contexto)`** (nueva). Aparta los cuerpos
   dollar-quoted (delimitadores incluidos) con un centinela sin `$` antes de delegar en
   Sequelize y los repone después, de modo que el motor recibe el texto exacto del
   endpoint. Las regiones salen del escáner, no de una búsqueda de `$$` a pelo: así un
   `$$` **dentro de un literal** (`SELECT '$$' AS a, $name AS b, '$$' AS c`) no se toma
   por un cuerpo y no se traga el `$name` real que va en medio. → **H3**.

### `src/lib/handler/ConnectionPool.js`

En `formatBindParameters`, tras `prepararSqlParaBinds`, si el dialecto es **PostgreSQL**
se llama a `protegerDollarQuoted()` y se repone el resultado:

```js
if (contextoEscaneo.dialect === "postgres") {
  const { sql: paraSequelize, restaurar } = protegerDollarQuoted(limpio, contextoEscaneo);
  const [sqlFinal, parametros] = Original.formatBindParameters.call(this, paraSequelize, values, dialect, ...resto);
  return [restaurar(sqlFinal), parametros];
}
```

El resto de dialectos no se toca. → **H3**.

### Tests de regresión (en el repo, dentro del packet)

`dev/test/sql_param_detection_test.js` incorpora tres bloques puros nuevos:

- `stripCasos` — H1, H2 (por dialecto) y H4 sobre el texto que se ejecuta.
- `dialectoCasos` — H2/H3/H4 sobre `scanSqlPlaceholders` + `prepararSqlParaBinds`.
- `dollarCasos` / `dollarIntactos` — H3 (`protegerDollarQuoted`), incluido el caso
  ambiguo de `$$` dentro de literales.

---

## 5. Limitaciones residuales (documentadas, no regresiones)

- **MariaDB + `$bind` dentro de `/*! … */`** sigue respondiendo 500. El servidor acepta
  `?` dentro de un comentario ejecutable (probado con `PREPARE`/`EXECUTE`), y el driver
  de MariaDB con `execute()` también; pero Sequelize usa `connection.query()`, cuya
  sustitución de `?` es del cliente y **no ve los comentarios ejecutables**, dejando el
  `?` literal. No es corregible desde el handler sin cambiar de driver. En MySQL sí
  funciona (200). La línea base también fallaba (500), así que no hay regresión.
- **`SELECT '$$'`** (un único `$$` dentro de un literal) sigue devolviendo `$`: la regex
  de Sequelize lo interpreta como `$$`→`$` y no hay una pareja que delimite un cuerpo.
  Es comportamiento previo, fuera de los hallazgos.
- **PostgreSQL y `$name` dentro de un cuerpo `$$ … $$`** se mantiene rechazado con 400
  (`SQL_BIND_INSIDE_LITERAL`): un `$nombre` en el cuerpo de una función no debe
  sustituirse en silencio. `protegerDollarQuoted()` no cambia ese criterio.

---

## 6. Cómo reproducir

```bash
# 1. Servidor con el código corregido (BD de plataforma en SQLite temporal)
rm -f /tmp/opencode/ofapi.sqlite
PORT=3100 TMPDIR=/tmp/opencode BUILD_DB=true node ./src/server.js

# 2. Línea base, worktree del commit padre 42bafea, en 3200
#    (symlink de node_modules y copia de .env, ver §7)

# 3. Comparativas (arnés de desarrollo, fuera del packet)
OFAPI_BASE_URL=http://localhost:3100 node comments_matrix.mjs
OFAPI_BASE_URL=http://localhost:3200 node comments_matrix.mjs

# 4. Suites puras y contra motor, dentro del repo
node dev/test/sql_param_detection_test.js
OFAPI_BASE_URL=http://localhost:3100 OFAPI_TEST_MSSQL_PASSWORD='…' node dev/test/sql_comments_test.js
```

## 7. Entorno de la prueba

- Servidor local lanzado desde el árbol de trabajo, no el contenedor `openfusionapi`
  (el contenedor del puerto 3000 no expone `/api/system/...`, así que no sirve de línea
  base).
- Línea base en un worktree de `42bafea` (`/tmp/opencode/ofapi-before`) con `node_modules`
  enlazado y `.env` copiado, puerto 3200.
- La BD de plataforma de cada servidor vive en su propio `TMPDIR` con `BUILD_DB=true`;
  los motores de prueba son contenedores Docker con la base `sqltest` sembrada.

