/**
 * Utility functions for extracting function calls from Gemini Live API messages
 */

/**
 * Extract all function calls from a Gemini Live API message
 * Checks multiple possible locations in the message structure
 * @param msg The LiveServerMessage from Gemini
 * @returns Array of function call objects with their paths
 */
export function extractFunctionCalls(msg: any): any[] {
  const functionCalls: any[] = [];
  const seenIds = new Set<string>();
  
  // Helper to add function call and track by ID to avoid duplicates
  const addFunctionCall = (fc: any, path: string) => {
    const funcCall = fc.functionCall || fc.function_call || fc;
    const id = funcCall?.id;
    
    // If we've seen this ID before, skip it (duplicate)
    if (id && seenIds.has(id)) {
      return;
    }
    
    // Track this ID
    if (id) {
      seenIds.add(id);
    }
    
    // Add the function call
    if (fc.functionCall || fc.function_call) {
      functionCalls.push(fc);
    } else {
      functionCalls.push({ path, functionCall: fc });
    }
  };
  
  // Method 0: Check top-level toolCall (most common for Live API based on design.md)
  // According to design.md line 76: "Function calls come from msg.toolCall.functionCalls[] (top-level)"
  if ((msg as any).toolCall?.functionCalls && Array.isArray((msg as any).toolCall.functionCalls)) {
    (msg as any).toolCall.functionCalls.forEach((fc: any) => {
      addFunctionCall({ path: 'toolCall.functionCalls', functionCall: fc }, 'toolCall.functionCalls');
    });
  }
  
  // Method 1: Check modelTurn.parts
  if (msg.serverContent?.modelTurn?.parts) {
    (msg.serverContent.modelTurn.parts as any[]).forEach((part: any) => {
      if (part.functionCall || part.function_call) {
        addFunctionCall(part, 'modelTurn.parts');
      }
    });
  }
  
  // Method 2: Check for functionCall directly in modelTurn
  const modelTurn = msg.serverContent?.modelTurn as any;
  if (modelTurn?.functionCall) {
    addFunctionCall({ functionCall: modelTurn.functionCall }, 'modelTurn');
  }
  
  // Method 3: Check for function_call (snake_case variant)
  if (modelTurn?.function_call) {
    addFunctionCall({ functionCall: modelTurn.function_call }, 'modelTurn');
  }
  
  // Method 4: Check for toolCall with functionCalls array in modelTurn
  if (modelTurn?.toolCall?.functionCalls) {
    modelTurn.toolCall.functionCalls.forEach((fc: any) => {
      addFunctionCall({ path: 'modelTurn.toolCall.functionCalls', functionCall: fc }, 'modelTurn.toolCall.functionCalls');
    });
  }
  
  // Method 5: Check entire message structure recursively (but skip if we already found calls via top-level toolCall)
  // Only use recursive search if we haven't found any calls yet (to avoid duplicates)
  if (functionCalls.length === 0) {
    const recursiveCalls = findFunctionCalls(msg);
    recursiveCalls.forEach((fc: any) => {
      addFunctionCall(fc, fc.path || 'recursive');
    });
  }
  
  return functionCalls;
}

/**
 * Recursively search for function calls in an object
 * @param obj The object to search
 * @param path Current path in the object structure
 * @returns Array of function calls found
 */
function findFunctionCalls(obj: any, path: string = ''): any[] {
  const results: any[] = [];
  if (!obj || typeof obj !== 'object') return results;
  
  // Check for functionCall or function_call keys
  if (obj.functionCall) {
    results.push({ path, functionCall: obj.functionCall });
  }
  if (obj.function_call) {
    results.push({ path, functionCall: obj.function_call });
  }
  
  // Check for toolCall with functionCalls array
  if (obj.toolCall?.functionCalls && Array.isArray(obj.toolCall.functionCalls)) {
    obj.toolCall.functionCalls.forEach((fc: any, idx: number) => {
      results.push({ 
        path: path ? `${path}.toolCall.functionCalls[${idx}]` : `toolCall.functionCalls[${idx}]`,
        functionCall: fc
      });
    });
  }
  
  // Recursively search nested objects
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
      results.push(...findFunctionCalls(obj[key], path ? `${path}.${key}` : key));
    }
  }
  
  return results;
}

