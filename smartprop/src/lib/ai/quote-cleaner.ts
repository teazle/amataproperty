/**
 * Aggressive Quote Cleaner
 * Removes all unwanted quotes from AI-generated messages
 * This is critical because quotes make messages look unnatural
 */

/**
 * Remove all leading and trailing quotes from a message
 * Handles multiple layers, escaped quotes, and various quote types
 */
export function cleanQuotes(message: string): string {
  if (!message || typeof message !== 'string') {
    return message || '';
  }

  let cleaned = message;
  const original = cleaned;

  // Step 1: Handle escaped quotes FIRST (before JSON parsing)
  // This handles cases where quotes are escaped like \"message\" or \'message\'
  cleaned = cleaned.replace(/\\"/g, '"').replace(/\\'/g, "'");

  // Step 2: Handle JSON-encoded strings (the AI might return the message as a JSON string)
  // Try parsing as JSON if it looks like a JSON string
  if (cleaned.trim().startsWith('"') && cleaned.trim().endsWith('"')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === 'string') {
        cleaned = parsed;
        // After parsing, check again for escaped quotes that might have been unescaped
        cleaned = cleaned.replace(/\\"/g, '"').replace(/\\'/g, "'");
      }
    } catch (e) {
      // Not valid JSON, continue with normal cleaning
    }
  }

  // Step 3: Remove any remaining escaped quotes (double pass to be sure)
  cleaned = cleaned.replace(/\\"/g, '"').replace(/\\'/g, "'");

  // Step 4: Remove quotes at the very start and end (handle multiple layers)
  cleaned = cleaned.trim();

  // Step 5: Aggressive loop to remove all outer quote layers
  let iterations = 0;
  const maxIterations = 20; // Increased from 10 to handle deeply nested quotes
  while (iterations < maxIterations) {
    const before = cleaned;

    // Remove outer quotes if they match (both single and double)
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // Also handle mismatched quotes (start with one type, end with another)
    if ((cleaned.startsWith('"') && cleaned.endsWith("'")) ||
        (cleaned.startsWith("'") && cleaned.endsWith('"'))) {
      // Remove both
      cleaned = cleaned.replace(/^["']/, '').replace(/["']$/, '').trim();
    }

    // If no change, break
    if (cleaned === before) {
      break;
    }

    iterations++;
  }

  // Step 6: Remove any remaining quotes at start/end with regex (more aggressive)
  cleaned = cleaned.replace(/^["']+/g, '').replace(/["']+$/g, '');

  // Step 7: Remove quotes that wrap the entire message using regex (multiline support)
  const quotePattern = /^["']([\s\S]+)["']$/;
  const match = cleaned.match(quotePattern);
  if (match) {
    cleaned = match[1];
  }

  // Step 8: Handle cases where quotes might be at different positions
  // Remove any leading/trailing quote characters one more time
  while ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
         (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    const before = cleaned;
    cleaned = cleaned.slice(1, -1).trim();
    if (cleaned === before) break; // Prevent infinite loop
  }

  // Step 9: Final aggressive pass: remove any leading/trailing quote characters
  cleaned = cleaned.replace(/^["']+|["']+$/g, '').trim();

  // Step 10: Check for common AI patterns that include quotes
  // Pattern: "message" or 'message' at the start/end
  const startEndQuotePattern = /^["']([\s\S]+?)["']$/;
  const startEndMatch = cleaned.match(startEndQuotePattern);
  if (startEndMatch) {
    cleaned = startEndMatch[1].trim();
  }

  // Step 11: Final trim and validation
  cleaned = cleaned.trim();

  // Log if we actually cleaned something (for debugging)
  if (original !== cleaned) {
    console.log('🧹 [QUOTE CLEANER] Removed quotes:', {
      before: original.substring(0, 100),
      after: cleaned.substring(0, 100),
      removedQuotes: original.length - cleaned.length
    });
  }

  return cleaned;
}

/**
 * Validate that a message doesn't start or end with quotes
 * Returns true if message is clean, false if quotes are detected
 */
export function hasQuotes(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const trimmed = message.trim();
  return (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    trimmed.match(/^["']/) !== null ||
    trimmed.match(/["']$/) !== null
  );
}
