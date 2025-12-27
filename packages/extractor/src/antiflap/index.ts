/**
 * Anti-flap state machine module
 *
 * Prevents false alerts by requiring N consecutive observations
 * of a new value before confirming a change.
 */

export { processAntiFlap } from './antiflap';
export { equals } from './equals';
export type { RuleState, AntiFlipResult } from './types';
