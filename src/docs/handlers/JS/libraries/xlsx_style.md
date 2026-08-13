<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `xlsx_style`

[External Documentation](https://github.com/gitbrent/xlsx-js-style) 

Styled XLSX builder based on SheetJS, useful when the exported workbook needs fonts, fills, borders, or alignment.

**Notes**

- Prefer xlsx_style over xlsx when presentation matters in the generated spreadsheet.

#### Example

```javascript

const wb = xlsx_style.utils.book_new();

let row = [
	{ v: "Courier: 24", t: "s", s: { font: { name: "Courier", sz: 24 } } },
	{ v: "bold & color", t: "s", s: { font: { bold: true, color: { rgb: "FF0000" } } } },
	{ v: "fill: color", t: "s", s: { fill: { fgColor: { rgb: "E9E9E9" } } } },
	{ v: "line
break", t: "s", s: { alignment: { wrapText: true } } },
];
const ws = xlsx_style.utils.aoa_to_sheet([row]);
xlsx_style.utils.book_append_sheet(wb, ws, "Styled Demo");

const buffer = xlsx_style.write(wb, { type: 'buffer', bookType: 'xlsx' });

$_CUSTOM_HEADERS_.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
$_CUSTOM_HEADERS_.set('Content-Disposition', 'attachment; filename="styled-demo.xlsx"');
$_RETURN_DATA_ = Buffer.from(buffer);
      
```

