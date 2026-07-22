# `QRCodeStyling`

[External Documentation](https://qr-code-styling.com/) 

Library to generate styled QR codes.

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
$_RETURN_DATA_ = buffer;
      
```

