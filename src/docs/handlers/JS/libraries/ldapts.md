<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `ldapts`

[External Documentation](https://ldapts.js.org/) 

Alias of `ldap` for the `ldapts` npm package. Both variables expose the same Promise-based LDAP client for connecting to LDAP v3 and Active Directory servers.

**Notes**

- Alias kept for the real package name. Prefer the short key `ldap` in new endpoint code.

**Agent Guidance**

- Use `ldapts` only in code already written against the package name; prefer `ldap` for new code.

#### Example

```javascript

const client = new ldapts.Client({ url: $_APP_VARS_['$_VAR_LDAP_URL'] });
try {
  await client.bind(
    $_APP_VARS_['$_VAR_LDAP_BIND_DN'],
    $_APP_VARS_['$_VAR_LDAP_BIND_PASSWORD'],
  );
  const { searchEntries } = await client.search(
    $_APP_VARS_['$_VAR_LDAP_BASE_DN'],
    { scope: 'sub', filter: '(objectClass=person)', sizeLimit: 50 },
  );
  $_RETURN_DATA_ = searchEntries;
} finally {
  await client.unbind();
}
      
```

