# `createPDFFromHTML([html], [url], [format], [landscape], [margin], [printBackground])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Generates a PDF document from an HTML string or a URL.

**Notes**

- Pass either html or url depending on whether the content is already available in memory.
- Supports both positional arguments style (html, url, format, landscape, margin, printBackground) and single object parameter style ({ html, url, format, landscape, margin, printBackground }).

**Agent Guidance**

- Use this for report exports, tickets, or printable documents assembled inside the handler.

**Parameters**

*   `html` <string> **Optional**. Raw HTML content to render.
*   `url` <string> **Optional**. URL of the page to convert to PDF.
*   `format` <string> **Optional**. Default: `A4`. Paper format (e.g., 'A4', 'Letter').
*   `landscape` <boolean> **Optional**. Whether to print in landscape mode.
*   `margin` <string> **Optional**. Default: `10mm`. Page margins (e.g., '10mm').
*   `printBackground` <boolean> **Optional**. Default: `true`. Whether to print background graphics.

*   Returns: NodeJS.ArrayBufferView

#### Example

```javascript

const pdf = await createPDFFromHTML('<html><body><h1>Monthly Report</h1></body></html>');

$_CUSTOM_HEADERS_.set("Content-Type", "application/pdf");
$_CUSTOM_HEADERS_.set(
  "Content-Disposition",
  'attachment; filename="file.pdf"',
);

$_RETURN_DATA_ = pdf;
      
```

