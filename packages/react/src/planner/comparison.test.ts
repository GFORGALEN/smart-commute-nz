import { describe, expect, it } from 'vitest';
import {
  compareOptions,
  createExampleOptions,
  DEFAULT_OWNERSHIP,
  DEFAULT_SETTINGS,
  type JourneyOption,
  type RouteResult,
} from '@smart-commute/core';
import { buildComparison, orderCards } from './comparison';
import { type PlannerState } from './types';

const plannerState = (options: JourneyOption[] = createExampleOptions()): PlannerState => ({
  origin: { label: '4 Fong Road' },
  destination: { label: 'Britomart' },
  settings: { ...DEFAULT_SETTINGS },
  options,
  places: [],
  savedRoutes: [],
  departure: '',
  returnTime: '',
  leaveNow: true,
  returnPolicy: 'estimate',
  ownership: { ...DEFAULT_OWNERSHIP },
  applyFareCap: true,
});

describe('buildComparison', () => {
  it('ranks complete options', () => {
    const state = plannerState();
    const comparison = buildComparison(state, state.options, {}, 0);
    expect(comparison.error).toBe(false);
    expect(comparison.result?.results.map((result) => result.id).sort()).toEqual(
      ['drive', 'hybrid', 'transit'].sort(),
    );
  });

  it('reports an error when either place is missing', () => {
    const state = { ...plannerState(), destination: { label: '  ' } };
    expect(buildComparison(state, state.options, {}, 0)).toMatchObject({
      result: null,
      error: true,
    });
  });

  it('keeps an option with a missing return out of the ranking', () => {
    const [drive, ...rest] = createExampleOptions();
    const oneWay = { ...drive!, inbound: [] };
    const state = plannerState([oneWay, ...rest]);
    const comparison = buildComparison(state, state.options, {}, 0);
    expect(comparison.incompleteOptions.map((option) => option.id)).toEqual(['drive']);
    expect(comparison.result?.results.some((result) => result.id === 'drive')).toBe(false);
  });

  it('shows no ranking, without an error, when nothing is visible yet', () => {
    const state = plannerState();
    expect(buildComparison(state, [], {}, 0)).toMatchObject({ result: null, error: false });
  });
});

describe('orderCards', () => {
  const results = (): RouteResult[] =>
    compareOptions(createExampleOptions(), DEFAULT_SETTINGS).results;

  it('keeps the cost ranking by default', () => {
    const ranked = results();
    expect(orderCards(ranked, 'cost').map((result) => result.id)).toEqual(
      ranked.map((result) => result.id),
    );
  });

  it('orders by time when asked', () => {
    const minutes = orderCards(results(), 'time').map((result) => result.totalMinutes);
    expect(minutes).toEqual([...minutes].sort((left, right) => left - right));
  });

  it('puts cards that would read the same after the distinct ones', () => {
    const [first, second] = results();
    const duplicate = { ...first!, id: 'duplicate' };
    expect(orderCards([first!, duplicate, second!], 'cost').map((result) => result.id)).toEqual([
      first!.id,
      second!.id,
      'duplicate',
    ]);
  });
});
