# MONGODB Handler – NoSQL Database Connector

The **MONGODB handler** allows OpenFusionAPI to connect to MongoDB clusters and execute JavaScript logic within a Mongoose-connected context.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint is configured with the **MONGODB** handler:
1.  **Connection Management**: It parses the connection configuration and establishes a connection to the MongoDB instance using `mongoose`.
    -   It intelligently manages connections, switching only if the configuration hash changes.
2.  **VM Execution**: Similar to the JS Handler, it compiles the provided code into a specialized VM function (`createFunctionVM`).
3.  **Context**: The script runs in a context where Mongoose models and operations are available via the active connection.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

The handler configuration can be structured in several ways inside the connection object (`config`/`custom_data`/`mongo_config`):

1. **Usando una URI directa (Recomendado para MongoDB Atlas)**:
```json
{
  "config": {
    "uri": "mongodb+srv://user:password@cluster.mongodb.net/my_database?appName=Cluster0",
    "options": {
      "ssl": true
    }
  },
  "code": " ... javascript logic ... "
}
```
Or directly as a string if only the connection URI is required.

2. **Estructura por partes (Legacy)**:
```json
{
  "config": {
    "host": "localhost",
    "port": 27017,
    "dbName": "my_database",
    "user": "admin",
    "pass": "secret",
    "options": {
      "useNewUrlParser": true
    }
  },
  "code": " ... javascript logic ... "
}
```

</details>

---

<details>
<summary>💻 Scripting Logic</summary>

The `code` property in the JSON config is treated as the body of an async function. You can use standard Mongoose logic here.

**Example Logic (`code` value)**:
```javascript
// Access existing models or define temporary ones (carefully)
// Note: Mongoose models are usually pre-defined in the app context.

const result = await mongoose.connection.db.collection('users').find({}).toArray();

return {
  data: result
};
```

</details>

---

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| MongoDB Connection | ✅ (Mongoose) |
| Connection Pooling | ✅ (Via Mongoose internals) |
| Custom Logic | ✅ (VM Execution) |
| Dynamic Config | ✅ |

</details>

---

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**
