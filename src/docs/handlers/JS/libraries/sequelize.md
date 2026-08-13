<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `sequelize`

[External Documentation](https://sequelize.org/) 

Sequelize is a modern TypeScript and Node.js ORM for Oracle, Postgres, MySQL, MariaDB, SQLite and SQL Server, and more.

**Notes**

- Useful for ad hoc relational DB operations inside JS handlers, but prefer the SQL handler when the endpoint is mostly a database proxy.

**Agent Guidance**

- Choose sequelize here only when you need transactions, model logic, or multi-step orchestration in JS instead of a single SQL statement.

#### Example

```javascript

const seq = new sequelize.Sequelize({
  dialect: "sqlite",
  storage: ":memory:",
  logging: false,
});

try {
  await seq.authenticate();
  await seq.query("CREATE TABLE users (iduser INTEGER PRIMARY KEY, name TEXT, email TEXT);");
  await seq.query("INSERT INTO users (iduser, name, email) VALUES (1, 'Juan', 'juan@mail.com'), (2, 'Ana', 'ana@mail.com');");

  const result = await seq.query(
    "SELECT * FROM users WHERE iduser = $iduser",
    {
      bind: { iduser: 1 },
      type: sequelize.QueryTypes.SELECT,
    }
  );

  $_RETURN_DATA_ = result;
} finally {
  await seq.close();
}

      
```

