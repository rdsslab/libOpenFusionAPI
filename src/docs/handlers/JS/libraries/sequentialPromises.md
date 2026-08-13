<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `sequentialPromises`

[External Documentation](https://github.com/rdsslab/sequential-promises) 

Legacy alias of PromiseSequence kept for backward compatibility.

**Notes**

- Deprecated alias. Prefer PromiseSequence in new endpoint code.

#### Example

```javascript

const result = await sequentialPromises.ByBlocks(async (item) => item, 2, [1, 2, 3, 4]);
$_RETURN_DATA_ = result;
      
```

