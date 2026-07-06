# `request_xlsx_body_to_json(request)`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Reads uploaded XLSX files from a multipart/form-data request and converts their sheets into JSON rows.

**Notes**

- Only multipart file fields are processed; regular text fields remain available on request.body.

**Agent Guidance**

- Use this helper only when the endpoint receives an uploaded spreadsheet; do not use it for plain JSON requests.

**Parameters**

*   `request` <object> Fastify request object containing multipart form-data files.

*   Returns: Array of objects with the data of each sheet of each Excel file.

#### Example

```javascript

const files = await request_xlsx_body_to_json(request);
const firstWorkbook = files[0];

$_RETURN_DATA_ = {
  filename: firstWorkbook?.filename,
  sheets: firstWorkbook?.sheets,
};
      
```

