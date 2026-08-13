<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `xlsx`

[External Documentation](https://docs.sheetjs.com/docs/) 

SheetJS Community Edition offers battle-tested open-source solutions for extracting useful data from almost any complex spreadsheet and generating new spreadsheets that will work with legacy and modern software alike.

**Agent Guidance**

- Use xlsx when you need direct workbook/worksheet operations. Use json_to_xlsx_buffer when you only need a quick downloadable XLSX file.

#### Example

```javascript

const rows = [
  { name: 'John', age: 30 },
  { name: 'Jane', age: 25 },
];

const worksheet = xlsx.utils.json_to_sheet(rows);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'Users');

const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

$_CUSTOM_HEADERS_.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
$_CUSTOM_HEADERS_.set('Content-Disposition', 'attachment; filename="users.xlsx"');
$_RETURN_DATA_ = Buffer.from(buffer);
      
```

