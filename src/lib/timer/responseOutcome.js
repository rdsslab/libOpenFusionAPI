/**
 * Interpreta el contrato opcional `{ success: boolean }` de un endpoint.
 * Sin ese campo, el código HTTP sigue siendo la fuente de verdad.
 */
export function getResponseOutcome(responseData) {
  const hasSuccess =
    responseData !== null &&
    typeof responseData === "object" &&
    !Array.isArray(responseData) &&
    Object.prototype.hasOwnProperty.call(responseData, "success");

  if (!hasSuccess || responseData.success === true) {
    return { success: true, error: null };
  }

  return {
    success: false,
    error:
      responseData.error ||
      responseData.message ||
      "Endpoint returned success: false",
  };
}