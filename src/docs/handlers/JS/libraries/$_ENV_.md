# `$_ENV_`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Current runtime environment (dev, qa, prd)

**Notes**

- This variable is injected automatically based on the server environment and can be used for environment-specific logic in handlers.

*   Returns: string

#### Example

```javascript
if ($_ENV_ === 'dev') { /* dev-only code */ }
```

