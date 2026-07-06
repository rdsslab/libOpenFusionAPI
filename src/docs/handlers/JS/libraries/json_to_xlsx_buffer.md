# `json_to_xlsx_buffer([data])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Builds an XLSX workbook in memory and returns the binary buffer plus download metadata.

**Notes**

- This helper does not send the file by itself; you still need to assign headers and return the buffer.

**Agent Guidance**

- If the endpoint should download a file, set $_CUSTOM_HEADERS_ from the returned metadata and assign only result.buffer to $_RETURN_DATA_.

**Parameters**

*   `data` <object> **Optional**. Workbook definition. Example: { filename: 'report.xlsx', sheets: [{ sheet: 'Sheet1', data: [{ id: 1 }] }] }

*   Returns: <object> Workbook binary and download metadata.

    **Result Structure:**

    *   `buffer` <Buffer> XLSX binary content.
    *   `filename` <string> Suggested filename.
    *   `contentDisposition` <string> Download header value.
    *   `ContentType` <string> MIME type for XLSX.

#### Example

```javascript

const data = {
  filename: 'users.xlsx',
  sheets: [
    {
      sheet: 'Users',
      data: [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ],
    },
  ],
};

const result = json_to_xlsx_buffer(data);

$_CUSTOM_HEADERS_.set('Content-Type', result.ContentType);
$_CUSTOM_HEADERS_.set('Content-Disposition', result.contentDisposition);

$_RETURN_DATA_ = result.buffer;
      
```

