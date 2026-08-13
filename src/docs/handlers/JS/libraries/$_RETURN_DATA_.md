<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `$_RETURN_DATA_`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Primary output slot for JS handlers. Assign the final payload here instead of using return.

**Notes**

- This is the supported JS handler response contract.

**Agent Guidance**

- Prefer assigning to $_RETURN_DATA_ over calling reply.send() directly unless you need low-level Fastify control.

*   Returns: Any values

#### Example

```javascript

$_RETURN_DATA_ = { name: 'John', age: 30 };
      
```

