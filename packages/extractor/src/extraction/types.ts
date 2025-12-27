/**
 * Result of an extraction operation
 */
export interface ExtractionResult {
  success: boolean;
  value: string | null;
  selectorUsed: string;
  fallbackUsed: boolean;
  error?: string;
}
