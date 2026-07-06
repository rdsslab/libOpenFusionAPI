# `createImageFromHTML([html], [url], [type], [quality], [fullPage])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Renders HTML content or a URL into an image buffer.

**Notes**

- Pass either html or url. If both are provided, your wrapper implementation defines precedence.
- Supports both positional arguments style (html, url, type, quality, fullPage) and single object parameter style ({ html, url, type, quality, fullPage }).

**Agent Guidance**

- Use this when the endpoint must return a screenshot-like image artifact generated on demand.

**Parameters**

*   `html` <string> **Optional**. String HTML
*   `url` <string> **Optional**. URL resource
*   `type` <string> **Optional**. Default: `png`. Output type
*   `quality` <integer> **Optional**. Default: `90`. quality
*   `fullPage` <boolean> **Optional**. Default: `true`. fullPage

*   Returns: NodeJS.ArrayBufferView

#### Example

```javascript

const image = await createImageFromHTML('<html><body><h1>Hello</h1></body></html>', '', 'png');

$_CUSTOM_HEADERS_.set("Content-Type", "image/png");
$_CUSTOM_HEADERS_.set(
  "Content-Disposition",
  'attachment; filename="file.png"',
);

$_RETURN_DATA_ = image;
      
```

