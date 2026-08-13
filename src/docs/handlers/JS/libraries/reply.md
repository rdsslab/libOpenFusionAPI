<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `reply`

[External Documentation](https://fastify.dev/docs/latest/Reference/Reply/#introduction) 

Fastify Reply object for low-level response control.

**Notes**

- Once you send a response manually with reply.send(), avoid also assigning a different value to $_RETURN_DATA_.

**Agent Guidance**

- Use reply directly only when $_RETURN_DATA_ and $_CUSTOM_HEADERS_ are not enough for the desired response behavior.

*   Returns: Fastify Reply object

#### Example

```javascript

reply.code(200).send({ name: 'John', age: 30 });
      
```

