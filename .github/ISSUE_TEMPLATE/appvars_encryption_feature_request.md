# Feature Request: Encriptación Opcional de AppVars

## Resumen

Implementar soporte para encriptar valores de Application Variables (AppVars) con opción de valor público/privado y backups encriptados o en texto plano.

## Estado Actual

**Problema:** Los valores de AppVars se almacenan en texto plano en la base de datos y los backups también los exportan sin protección.

### Evidencia

1. **Modelo `AppVars`** (`src/lib/db/models.js`): La columna `value` es de tipo JSON/TEXT sin encriptación
2. **Resolución de AppVars** (`src/lib/handler/utils.js`): Los valores se leen directamente y se usan "tal cual"
3. **Backup de aplicaciones** (`src/lib/db/app.js`): Los AppVars se restauran con su valor original en texto plano

### Escenarios de Riesgo

| Escenario | Riesgo | Impacto |
|-----------|--------|---------|
| Acceso directo a BD | Créditos, tokens, claves en texto plano | Crítico |
| Backup restaurado | Valores expuestos en archivo JSON | Crítico |
| Exportación GUI | Datos visibles al operador | Alto |
| Migración entre entornos | Valores viajan sin protección | Alto |

## Propuesta de Solución

### Arquitectura

1. **Encriptación opcional por AppVar** - Campo `is_public` controla si el valor va encriptado o en texto plano
2. **Backups con contenido encriptado o en texto plano** - Parámetro configurable
3. **Clave maestra almacenada en variable de entorno** - Compatible con Docker

### Cambios Propuestos

#### 1. Nuevos campos en el modelo `AppVars`

```javascript
valueEncrypted: {
  type: DataTypes.TEXT,
  allowNull: true,
  comment: "AppVar value encrypted with AES-256-GCM"
},

is_public: {
  type: DataTypes.BOOLEAN,
  defaultValue: false,
  allowNull: false,
  comment: "If true, value is stored in plaintext for public backups. If false, value is encrypted."
},

encryption_key_version: {
  type: DataTypes.INTEGER,
  defaultValue: 1,
  allowNull: false
}
```

#### 2. Nuevo módulo `src/lib/db/crypto.js`

- `encryptValue(plaintext)` - Encripta usando AES-256-GCM
- `decryptValue(encrypted)` - Desencripta y valida autenticidad
- `initEncryptionKey()` - Inicializa desde `APPVAR_ENCRYPTION_KEY`
- `generateEncryptionKey()` - Genera clave aleatoria 64 caracteres hex

#### 3. Actualización de `upsertAppVar`

- Si `is_public === true`: almacenar en campo `value` (texto plano)
- Si `is_public === false`: encriptar y almacenar en `valueEncrypted`
- Validar que `APPVAR_ENCRYPTION_KEY` esté configurado cuando se requiera encriptación

#### 4. Actualización de `resolveAppVar`

- Verificar si el valor está encriptado (`!is_public && valueEncrypted`)
- Desencriptar automáticamente antes de retornar
- Manejar errores de desencriptación graceful

#### 5. Nuevo parámetro en backup

```javascript
generateAppBackup(appName, encryptValues = true)
```

- Si `encryptValues === true`: incluir valores privados encriptados o omitirlos
- Si `encryptValues === false`: incluir valores en texto plano (para migración)

### Variable de Entorno Requerida

```env
# Encryption key for AppVars (32 bytes = 64 hex characters)
# Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APPVAR_ENCRYPTION_KEY=your_64_character_hex_key_here
```

### Comportamiento Esperado

| Campo `value` | Campo `valueEncrypted` | Campo `is_public` | Resultado |
|---------------|------------------------|-------------------|-----------|
| NULL | NULL | false | **Encriptado** (valor en `valueEncrypted`) |
| valor | NULL | true | **Texto plano** (valor en `value`) |
| NULL | valor | false | **Encriptado** (valor en `valueEncrypted`) |

### Compatibilidad con GUI

- La GUI continuará leyendo `app_vars` y `app_vars_catalog`
- Los valores descifrados serán devueltos automáticamente
- Campo `is_public` permitirá marcar variables como visibles/ocultas

### Migración de Datos Existentes

Script único que:
1. Lee todos los AppVars con valores en texto plano
2. Encripta los valores donde `is_public !== true`
3. Actualiza `encryption_key_version`

## Archivos a Modificar

- [ ] `src/lib/db/models.js` - agregar nuevos campos
- [ ] `src/lib/db/crypto.js` - nuevo archivo
- [ ] `src/lib/db/appvars.js` - modificar `upsertAppVar`
- [ ] `src/lib/handler/utils.js` - modificar `resolveAppVar`
- [ ] `src/lib/db/app.js` - agregar `generateAppBackup`
- [ ] `src/lib/server/functions/system/prd/appvars/index.js` - manejar `is_public`
- [ ] Documentación y ejemplos

## Ventajas

- Protección de credenciales sensibles en reposo
- Backups seguros por defecto
- Flexible para casos de uso específicos
- Compatible con arquitectura Docker existente

## Consideraciones

- Overhead criptográfico mínimo (AES-256-GCM es rápido)
- La clave de encriptación NO puede ser recuperada automáticamente
- Rotación de claves requerirá proceso manual
- Los valores siempre estarán en memoria del proceso en texto plano

## Referencias

- [Node.js Crypto Documentation](https://nodejs.org/api/crypto.html)
- [AES-GCM en Node.js](https://nodejs.org/api/crypto.html#cryptographic-operations)

---

**Etiquetas sugeridas:** `enhancement`, `security`, `feature-request`, `encryption`, `appvars`