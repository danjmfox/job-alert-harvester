import { it } from 'vitest';

/** Every scenario is pending until DELIVER enables it; RED_GATE=1 runs them all for classification. */
export const scenario = process.env.RED_GATE === '1' ? it : it.skip;
