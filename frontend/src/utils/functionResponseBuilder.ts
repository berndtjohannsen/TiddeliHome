/**
 * Utility functions for building function response payloads for Gemini Live API
 */

/**
 * Build a function response payload for the Gemini Live API
 * @param functionName The name of the function that was called
 * @param functionCallId The ID of the function call (optional, but recommended)
 * @param responseData The response data to send back (can be any object)
 * @param thoughtSignature The thought signature from the original function call (optional)
 * @returns A properly formatted function response payload
 */
export function buildFunctionResponse(
  functionName: string,
  functionCallId: string | undefined,
  responseData: any,
  thoughtSignature?: string | undefined
): any {
  // Build the base response payload structure
  // For Live API, we must use toolResponse with functionResponses array
  // This matches the structure of toolCall.functionCalls that we receive
  // The function response object should match the structure of the function call
  const functionResponseObj: any = {
    name: functionName,
    response: responseData
  };
  
  // Include id if functionCallId exists (required for matching the function call)
  if (functionCallId) {
    functionResponseObj.id = functionCallId;
  }
  
  // Include thought signature if present (required by API for context continuity)
  if (thoughtSignature) {
    functionResponseObj.thoughtSignature = thoughtSignature;
  }
  
  // For sendToolResponse, we return the FunctionResponse object directly
  // (not wrapped in clientContent.turn.toolResponse)
  // The SDK's sendToolResponse method expects functionResponses: FunctionResponse[] | FunctionResponse
  return functionResponseObj;
}

