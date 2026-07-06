# `$_EXCEPTION_(message, [data], [statusCode])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Interrupts the program flow and throws an exception with a specific message and status code.

**Parameters**

*   `message` <string> The error message to display.
*   `data` <any> **Optional**. Additional context data for the error.
*   `statusCode` <integer> **Optional**. Default: `500`. HTTP Status Code for the response.

*   Returns: <void> Throws an exception object that stops execution.

    **Result Structure:**

    *   `message` <string> The error message.
    *   `data` <any> Context data.
    *   `statusCode` <integer> HTTP Status Code.

#### Example

```javascript
// simple usage
$_EXCEPTION_("Invalid input parameter");

// with data and status code
$_EXCEPTION_("User not found", { userId: 123 }, 404);
```

