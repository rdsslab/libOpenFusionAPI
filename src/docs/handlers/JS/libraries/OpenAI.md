<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `OpenAI`

[External Documentation](https://github.com/openai/openai-node) 

Official OpenAI SDK for calling language, reasoning, and multimodal models from JS handlers.

**Notes**

- Requires a valid API key, typically injected through App Vars or environment variables.
- Outbound network access must be available from the server running the JS handler.

**Agent Guidance**

- Use this when the endpoint must call an external OpenAI model directly instead of delegating to another internal endpoint.
- Return only the relevant subset of the SDK response unless the caller explicitly needs raw provider metadata.

*   Returns: OpenAI client instance

#### Example

```javascript

const client = new OpenAI({
  apiKey: endpointEnv.OPENAI_API_KEY,
});

const response = await client.responses.create({
  model: 'gpt-4.1-mini',
  input: 'Summarize in one sentence what OpenFusionAPI does.',
});

$_RETURN_DATA_ = {
  text: response.output_text,
  id: response.id,
};
      
```

