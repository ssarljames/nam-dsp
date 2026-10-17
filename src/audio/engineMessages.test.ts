import { describe, expect, it } from 'vitest';
import { POST_EFFECTS, isPostOrder } from './engineMessages';

/** Every ordering of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('POST_EFFECTS', () => {
  it('lists the four POST effects in the default order', () => {
    expect(POST_EFFECTS).toEqual(['chorus', 'tremolo', 'delay', 'reverb']);
  });
});

describe('isPostOrder', () => {
  it('accepts every permutation of the four', () => {
    const all = permutations(['chorus', 'tremolo', 'delay', 'reverb']);
    expect(all).toHaveLength(24);
    for (const order of all) expect(isPostOrder(order)).toBe(true);
  });

  it('refuses anything else', () => {
    const hostile: unknown[] = [
      undefined,
      null,
      'chorus,delay,reverb',
      {},
      [],
      ['chorus', 'delay'],
      ['chorus', 'delay', 'delay'],
      ['chorus', 'delay', 'reverb', 'reverb'],
      ['chorus', 'delay', 'reverb'],
      ['chorus', 'tremolo', 'delay', 'reverb', 'reverb'],
      ['chorus', 'tremolo', 'delay', 'drive'],
      ['chorus', 'delay', 'drive'],
      ['Chorus', 'Delay', 'Reverb'],
      [0, 1, 2],
    ];
    for (const raw of hostile) expect(isPostOrder(raw)).toBe(false);
  });
});
