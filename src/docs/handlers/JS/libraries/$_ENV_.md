<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `$_ENV_`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Current runtime environment (dev, qa, prd)

**Notes**

- This variable is injected automatically based on the server environment and can be used for environment-specific logic in handlers.

*   Returns: string

#### Example

```javascript
if ($_ENV_ === 'dev') { /* dev-only code */ }
```

