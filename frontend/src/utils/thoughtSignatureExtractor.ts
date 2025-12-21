/**
 * Utility functions for extracting thought signatures from Gemini Live API messages
 * Thought signatures are required for function responses according to Gemini API documentation
 */

/**
 * Extract thought signature from a Gemini Live API message
 * Checks multiple possible locations in the message structure
 * @param msg The LiveServerMessage from Gemini
 * @param funcCall The function call object (optional, for direct access)
 * @param item The item containing the function call (optional, for direct access)
 * @param modelTurn The modelTurn object (optional, for direct access)
 * @returns The thought signature string, or undefined if not found
 */
export function extractThoughtSignature(
  msg: any,
  funcCall?: any,
  item?: any,
  modelTurn?: any
): string | undefined {
  // Check multiple possible locations in order of likelihood
  
  // 1. Directly in function call object
  if (funcCall) {
    const sig = (funcCall as any)?.thoughtSignature || (funcCall as any)?.thought_signature;
    if (sig) return sig;
  }
  
  // 2. In the item wrapper
  if (item) {
    const sig = (item as any)?.thoughtSignature || (item as any)?.thought_signature;
    if (sig) return sig;
  }
  
  // 3. In modelTurn object (passed or from message)
  const mt = modelTurn || msg.serverContent?.modelTurn;
  if (mt) {
    const sig = (mt as any)?.thoughtSignature || (mt as any)?.thought_signature;
    if (sig) return sig;
  }
  
  // 4. In serverContent.modelTurn
  if (msg.serverContent?.modelTurn) {
    const sig = (msg.serverContent.modelTurn as any)?.thoughtSignature ||
                (msg.serverContent.modelTurn as any)?.thought_signature;
    if (sig) return sig;
  }
  
  // 5. In top-level toolCall structure
  if ((msg as any).toolCall) {
    const sig = (msg as any).toolCall?.thoughtSignature ||
                (msg as any).toolCall?.thought_signature;
    if (sig) return sig;
    
    // Also check in functionCalls array within toolCall
    if (Array.isArray((msg as any).toolCall.functionCalls)) {
      for (const fc of (msg as any).toolCall.functionCalls) {
        const fcSig = fc?.thoughtSignature || fc?.thought_signature;
        if (fcSig) return fcSig;
      }
    }
  }
  
  // 6. Top-level message
  const sig = (msg as any)?.thoughtSignature || (msg as any)?.thought_signature;
  if (sig) return sig;
  
  // 7. Check in parts array for thought signatures (they might be in parts with functionCall)
  if (msg.serverContent?.modelTurn?.parts) {
    for (const part of msg.serverContent.modelTurn.parts) {
      const partAny = part as any;
      // Check for thought signature directly in part
      if (partAny.thoughtSignature || partAny.thought_signature) {
        return partAny.thoughtSignature || partAny.thought_signature;
      }
      // Also check if the part itself is a thought part
      if (partAny.thought && (partAny.thoughtSignature || partAny.thought_signature)) {
        return partAny.thoughtSignature || partAny.thought_signature;
      }
    }
  }
  
  return undefined;
}

