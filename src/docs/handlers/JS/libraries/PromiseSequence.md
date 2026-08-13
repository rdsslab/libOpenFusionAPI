<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `PromiseSequence`

[External Documentation](https://github.com/rdsslab/sequential-promises) 

Utility for processing async tasks sequentially or in controlled batches.

**Notes**

- Useful when you must avoid flooding an external API or database with too many parallel calls.

**Agent Guidance**

- Use this when order matters or when downstream systems require throttled execution.

#### Example

```javascript

function processBlock(block) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ data: block * 2 });
    }, 250);
  });
}

const data = [1, 2, 3, 4, 5];
const batchSize = 2;

const result = await PromiseSequence.ByItems(processBlock, batchSize, data);
$_RETURN_DATA_ = result;
      
```

