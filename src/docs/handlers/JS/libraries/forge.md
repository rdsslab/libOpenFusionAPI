<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `forge`

[External Documentation](https://github.com/digitalbazaar/forge) 

A native implementation of TLS (and various other cryptographic tools) in JavaScript.

*   Returns: Read documentation

#### Example

```javascript

const pki = forge.pki;
const keys = pki.rsa.generateKeyPair(2048);
const pem = pki.encryptRsaPrivateKey(keys.privateKey, 'password');
$_RETURN_DATA_ = pem;
      
```

