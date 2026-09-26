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

`custom_data` **is** the connection config: the keys live at the root of the object. There is no
`config` or `mongo_config` wrapper. Nesting the connection under `config` leaves the handler with
`uri`, `host`, `port`, `dbName`, `user` and `pass` all undefined, and the request fails when Mongoose
tries to build a connection string out of them.

1. **Usando una URI directa (Recomendado para MongoDB Atlas)** — `uri` also at the root:
```json
{
  "uri": "mongodb+srv://user:password@cluster.mongodb.net/my_database?appName=Cluster0",
  "dbName": "my_database",
  "options": {
    "ssl": true
  }
}
```
When `uri` is present, `dbName`, `user` and `pass` are forwarded from the top-level keys as Mongoose
connection options.

2. **Estructura por partes**:
```json
{
  "host": "localhost",
  "port": 27017,
  "dbName": "my_database",
  "user": "admin",
  "pass": "secret",
  "options": {
    "useNewUrlParser": true
  }
}
```

If `custom_data` is empty the handler connects to `localhost:27017` with database `my_db` and no
credentials, so a misconfigured endpoint can appear to work while reading a different database.

**Application Variables**: like the other handlers, a bare `"$_VAR_MONGO_DB"` string in `custom_data`
is resolved to the stored config before the handler runs. The value must still be a valid JSON
object, and a raw (non-JSON) URI string is rejected with
`400 Invalid JSON in method custom_data/AppVar`.

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
