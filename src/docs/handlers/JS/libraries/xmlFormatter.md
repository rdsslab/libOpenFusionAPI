<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `xmlFormatter`

[External Documentation](https://github.com/chrisbottin/xml-formatter) 

Formats XML into a readable, pretty-printed string.

**Notes**

- Useful for debugging SOAP/XML payloads before returning them or saving them to logs.

*   Returns: Formatted XML string

#### Example

```javascript

const xml = '<root><child>Hello</child></root>';
const formattedXml = xmlFormatter(xml, { indentation: '  ' });
$_RETURN_DATA_ = formattedXml;
      
```

