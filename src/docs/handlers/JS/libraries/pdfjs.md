<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `pdfjs`

[External Documentation](https://mozilla.github.io/pdf.js/) 

PDF parsing library for reading text, metadata, and page structure from PDF documents.

**Notes**

- This is useful for extraction and inspection, not for generating PDFs.

**Agent Guidance**

- Use this when the endpoint must inspect uploaded or downloaded PDFs; do not use it for PDF generation workflows.

#### Example

```javascript

const fileResponse = await fetch('https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf');
const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

const doc = await pdfjs.getDocument({ data: fileBuffer }).promise;
const page = await doc.getPage(1);
const content = await page.getTextContent();

$_RETURN_DATA_ = {
  pages: doc.numPages,
  firstPageTextItems: content.items.length,
};
      
```

