<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `mongoose`

[External Documentation](https://mongoosejs.com) 

MongoDB ODM for defining schemas, models, and queries with validation support.

**Notes**

- Long-lived connections should be reused carefully; close temporary connections when the job is done.

**Agent Guidance**

- Prefer MONGODB handlers for direct data access endpoints; use mongoose in JS handlers when you need schema logic, orchestration, or mixed business rules.

#### Example

```javascript

await mongoose.connect('mongodb://127.0.0.1:27017/test');

const Cat = mongoose.model('Cat', { name: String });
await Cat.create({ name: 'Zildjian' });

const cats = await Cat.find().lean();
await mongoose.disconnect();

$_RETURN_DATA_ = cats;
      
```

