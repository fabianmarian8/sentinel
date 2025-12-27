import { PostprocessOp } from '@sentinel/shared';

/**
 * Apply postprocessing operations to extracted value
 */
export function applyPostprocess(value: string, ops: PostprocessOp[]): string {
  let result = value;

  for (const op of ops) {
    switch (op.op) {
      case 'trim':
        result = result.trim();
        break;

      case 'lowercase':
        result = result.toLowerCase();
        break;

      case 'uppercase':
        result = result.toUpperCase();
        break;

      case 'collapse_whitespace':
        result = result.replace(/\s+/g, ' ').trim();
        break;

      case 'replace':
        result = result.replaceAll(op.from, op.to);
        break;

      case 'regex_extract': {
        const match = result.match(new RegExp(op.pattern));
        if (match && match[op.group] !== undefined) {
          result = match[op.group]!; // Non-null assertion since we checked above
        }
        // If no match or group doesn't exist, keep original value
        break;
      }
    }
  }

  return result;
}
