<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `QRCodeStyling`

[External Documentation](https://qr-code-styling.com/) 

Library to generate styled QR codes. In the OpenFusionAPI JS handler this is the Node-compatible build (`qr-code-styling/lib/qr-code-styling.common.js`), with `node-canvas` and `jsdom` injected automatically.

**Notes**

- `getRawData` returns a `Buffer` in Node.js.
- Do not pass `nodeCanvas` or `jsdom` manually; they are provided by the runtime.

**Agent Guidance**

- Use this for generating customized and styled QR codes.

#### Example

```javascript

const qrCode = new QRCodeStyling({
  width: 300,
  height: 300,
  data: "https://www.example.com",
  dotsOptions: { color: "#4267b2", type: "rounded" },
  backgroundOptions: { color: "#e9ebee" }
});
const buffer = await qrCode.getRawData("png");

$_CUSTOM_HEADERS_.set("Content-Type", "image/png");
$_RETURN_DATA_ = buffer;
      
```

