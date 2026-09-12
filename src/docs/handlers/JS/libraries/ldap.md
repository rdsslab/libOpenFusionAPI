<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `ldap([new Client({ url, tlsOptions? })], [client.bind(userDN, password, controls?)], [client.search(baseDN, { scope?, filter?, attributes?, sizeLimit?, timeLimit?, paged? })], [client.add(dn, attributes) / client.modify(dn, changes) / client.del(dn)], [client.unbind()], [ldap.escapeFilter(value)])`

[External Documentation](https://ldapts.js.org/) 

Modern Promise-based LDAP client for connecting to LDAP v3 and Active Directory servers directly from JS handlers. Supports bind (validating user credentials), search, add, modify, delete, and password changes (Change with modify).

**Notes**

- This module is the `ldapts` npm package exposed under the short alias `ldap`.
- All operations return Promises, so they work inside the async wrapper of the JS handler.
- Never hardcode credentials. Read bind DN/password from Application Variables, e.g. $_APP_VARS_['$_VAR_LDAP_URL'].
- Always call `client.unbind()` in a `finally` block to release the connection.
- Prefer `ldaps://` (LDAP over TLS) in production; plain `ldap://` sends credentials in clear text.
- To validate a user's password you normally find the user DN first and then `bind()` with that DN and the typed password.
- Use `ldap.escapeFilter(value)` on any untrusted filter input to prevent LDAP injection.
- Use `sizeLimit` in searches to cap result sets and avoid memory-heavy responses.

**Agent Guidance**

- Use `ldap` (alias `ldapts`) when the endpoint must query LDAP/Active Directory or validate user credentials against the directory.
- Pull host, bind credentials and base DN from Application Variables in the form $_APP_VARS_['$_VAR_...']; never inline secrets in the endpoint code.
- Structure the flow as: new Client -> bind() -> search()/write ops -> unbind() in a finally block.
- For authentication checks, do not return the bind password or the full DN to the caller; return only a boolean or safe identity fields.
- Escape all user-supplied values used inside filters with ldap.escapeFilter(...) to avoid LDAP injection.
- Avoid unrestricted 'sub' searches without sizeLimit; always cap results and requested attributes.
- Prefer read-only service accounts unless the handler genuinely must create/modify directory entries.

**Parameters**

*   `new Client({ url, tlsOptions? })` <function> **Optional**. Creates an LDAP client. `url` uses the `ldap://` or `ldaps://` scheme, e.g. `ldaps://dc.example.com:636`. `tlsOptions` is optional and only applies when the URL uses `ldaps://`.
*   `client.bind(userDN, password, controls?)` <function> **Optional**. Authenticates against the directory. `userDN` is the full distinguished name (e.g. `CN=svc-api,OU=Service Accounts,DC=example,DC=com`) or a UPN such as `user@example.com`. On failure it rejects with an LDAP-specific error.
*   `client.search(baseDN, { scope?, filter?, attributes?, sizeLimit?, timeLimit?, paged? })` <function> **Optional**. Searches entries below `baseDN`. Returns `{ searchEntries, searchReferences }`. `scope` is `base`, `one`, or `sub`; `filter` is an LDAP filter string; `attributes` limits returned attributes; `sizeLimit` caps results; `paged: true` requests paged results.
*   `client.add(dn, attributes) / client.modify(dn, changes) / client.del(dn)` <function> **Optional**. Writes entries. `modify` receives an array of `Change` objects (e.g. `new ldap.Change({ operation: 'replace', modification: new ldap.Attribute({ type: 'mail', values: ['new@example.com'] }) })`).
*   `client.unbind()` <function> **Optional**. Gracefully closes the connection. Always call it in a `finally` block after bind/search work is done.
*   `ldap.escapeFilter(value)` <function> **Optional**. Escapes special LDAP filter characters in untrusted input so it cannot inject LDAP filter syntax.

*   Returns: <object> ldapts module exposing the Client class, filter constructors (AndFilter, OrFilter, EqualityFilter, etc.), Attribute, Change, and error classes.

    **Result Structure:**

    *   `Client` <class> LDAP client instance built with `new Client({ url })`.
    *   `Attribute` <class> Attribute definition used in add/modify operations.
    *   `Change` <class> Modification descriptor used with `modify`. Operations: add, delete, replace, increment.
    *   `escapeFilter` <function> Escapes LDAP filter metacharacters from untrusted input.

#### Example

```javascript

const client = new ldap.Client({
  url: $_APP_VARS_['$_VAR_LDAP_URL'], // e.g. 'ldaps://dc.example.com:636'
});

try {
  await client.bind(
    $_APP_VARS_['$_VAR_LDAP_BIND_DN'],
    $_APP_VARS_['$_VAR_LDAP_BIND_PASSWORD'],
  );

  // Filter input coming from the caller is untrusted: escape it.
  const nameFilter = request.query?.name
    ? '(cn=*' + ldap.escapeFilter(request.query.name) + '*)'
    : '(objectClass=person)';

  const { searchEntries } = await client.search(
    $_APP_VARS_['$_VAR_LDAP_BASE_DN'],
    {
      scope: 'sub',
      filter: nameFilter,
      attributes: ['cn', 'mail', 'memberOf'],
      sizeLimit: 100,
    },
  );

  $_RETURN_DATA_ = searchEntries;
} finally {
  await client.unbind();
}
      
```

