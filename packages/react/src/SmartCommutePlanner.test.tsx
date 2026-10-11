import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartCommutePlanner, type SmartCommutePlannerProps } from './SmartCommutePlanner';
import { RouteProviderError } from '@smart-commute/providers';
import {
  createExampleOptions,
  DEFAULT_SETTINGS,
  type Location,
  type RouteResult,
} from '@smart-commute/core';

const google = vi.hoisted(() => ({
  configure: vi.fn(),
  initializeMap: vi.fn(),
  getRoutes: vi.fn(),
  renderRoute: vi.fn(),
  dispose: vi.fn(),
  attachAutocomplete: vi.fn(),
  clearMapRoutes: vi.fn(),
  beginWaypointSelection: vi.fn(),
  renderWaypointMarkers: vi.fn(),
  clearWaypointMarkers: vi.fn(),
  getPlaceHours: vi.fn(),
}));
vi.mock('@smart-commute/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smart-commute/providers')>()),
  GoogleRouteProvider: class {
    constructor(options: unknown) {
      google.configure(options);
    }
    initializeMap = google.initializeMap;
    getRoutes = google.getRoutes;
    renderRoute = google.renderRoute;
    clearMapRoutes = google.clearMapRoutes;
    dispose = google.dispose;
    attachAutocomplete = google.attachAutocomplete;
    beginWaypointSelection = google.beginWaypointSelection;
    renderWaypointMarkers = google.renderWaypointMarkers;
    clearWaypointMarkers = google.clearWaypointMarkers;
    getPlaceHours = google.getPlaceHours;
    getMetrics = () => ({ routeRequests: 1 });
  },
}));

const defaultProps = { destination: 'Britomart, Auckland' };
const autocompleteSelectors: ((place: Location) => void)[] = [];
const autocompleteCleanups: ReturnType<typeof vi.fn>[] = [];
function liveResponse(id = 'google-drive-test', roundTrip = false) {
  return {
    routes: [
      {
        id,
        name: 'Google driving route',
        mode: 'drive' as const,
        outbound: [
          {
            mode: 'drive' as const,
            distanceKm: 10,
            durationMinutes: 20,
            source: 'google' as const,
            estimated: true,
          },
        ],
        inbound: roundTrip
          ? [
              {
                mode: 'drive' as const,
                distanceKm: 11,
                durationMinutes: 22,
                source: 'google' as const,
                estimated: true,
              },
            ]
          : [],
        parkingCost: 0,
        waypoints: [],
      },
    ],
    warnings: ['Traffic is not included in these durations.'],
    attribution: 'Google Maps',
    attributionLinks: [{ label: 'Transit agency', url: 'https://at.govt.nz/' }],
    requestCount: 1,
  };
}
function rangedTransitResponse(roundTrip = false) {
  const transitLeg = (min: number, max: number, stopCount: number) => ({
    mode: 'bus' as const,
    durationMinutes: 25,
    distanceKm: 10,
    transfers: 0,
    source: 'google' as const,
    estimated: true,
    fareSource: 'at-estimate' as const,
    fareRange: {
      min,
      max,
      source: 'at-estimate' as const,
      basis: 'standard-adult' as const,
      assumptions: ['Standard adult AT HOP/contactless fare; fare zones are unverified.'],
    },
    transit: {
      stopCount,
      departureStop: 'Origin bus stop',
      arrivalStop: 'Destination bus stop',
      lineName: 'Auckland bus route',
      lineShortName: '70',
      agencyNames: ['Auckland Transport'],
    },
  });
  return {
    routes: [
      {
        id: 'google-transit-range',
        name: 'Google public transport route',
        mode: 'transit' as const,
        outbound: [transitLeg(3, 7.9, 12)],
        inbound: roundTrip ? [transitLeg(4.9, 6.5, 7)] : [],
        parkingCost: 0,
        waypoints: [],
      },
    ],
    warnings: ['Google route durations are estimates.'],
    attribution: 'Google Maps',
    attributionLinks: [{ label: 'Auckland Transport', url: 'https://at.govt.nz/' }],
    requestCount: 1,
  };
}
const expectMoneyRange = (element: HTMLElement, min: number, max: number) => {
  expect(element).toHaveTextContent(min.toFixed(2));
  expect(element).toHaveTextContent(max.toFixed(2));
  expect(element.textContent).toMatch(/[–—-]/);
};
async function renderGooglePlanner(extraProps: Partial<SmartCommutePlannerProps> = {}) {
  const result = render(
    <SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" {...extraProps} />,
  );
  await waitFor(() => expect(google.initializeMap).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Plan route' })).toBeEnabled());
  return result;
}
const useOneWay = () =>
  fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
const planRoute = () => fireEvent.click(screen.getByRole('button', { name: 'Plan route' }));
async function planRangedTransit(
  roundTrip = false,
  extraProps: Partial<SmartCommutePlannerProps> = {},
) {
  google.getRoutes.mockResolvedValueOnce(rangedTransitResponse(roundTrip));
  const rendered = await renderGooglePlanner(extraProps);
  if (!roundTrip)
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
  await screen.findByTestId('cost-google-transit-range');
  return rendered;
}
async function addGoogleStop(location: Location) {
  fireEvent.click(screen.getByRole('button', { name: 'Add stop' }));
  await screen.findByLabelText('Search an intermediate stop', { exact: true });
  const widgetCall = [...google.attachAutocomplete.mock.calls]
    .reverse()
    .find((call) => call[3]?.label === 'Search an intermediate stop');
  const cleanup = autocompleteCleanups[google.attachAutocomplete.mock.calls.indexOf(widgetCall!)];
  act(() => widgetCall![1](location));
  return cleanup;
}
const goTo = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const changeNumber = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const localDateTime = (iso: string) => {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
};
function prepareATTransit(supergold = false) {
  fireEvent.click(screen.getByLabelText('Leave now', { exact: true }));
  fireEvent.change(screen.getByLabelText('Departure time', { exact: true }), {
    target: { value: localDateTime('2026-10-08T09:10:00+13:00') },
  });
  fireEvent.change(screen.getByLabelText('Return time', { exact: true }), {
    target: { value: localDateTime('2026-10-08T17:00:00+13:00') },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
  fireEvent.click(screen.getByText('Estimate with AT fare rules', { exact: true }));
  changeNumber('Outbound verified zones', '2');
  changeNumber('Return verified zones', '2');
  fireEvent.click(
    screen.getByLabelText('I have verified these fare zones in the official AT Journey Planner.'),
  );
  if (supergold) {
    changeNumber('Passenger type', 'supergold');
    fireEvent.click(
      screen.getByLabelText('My eligible concession is registered on my AT HOP card.'),
    );
  }
  fireEvent.click(screen.getByRole('button', { name: 'Apply AT fare estimate' }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  autocompleteSelectors.length = 0;
  autocompleteCleanups.length = 0;
  google.initializeMap.mockReset().mockResolvedValue(undefined);
  google.getRoutes.mockReset().mockResolvedValue(liveResponse());
  google.beginWaypointSelection.mockReset().mockReturnValue(vi.fn());
  google.attachAutocomplete
    .mockReset()
    .mockImplementation(
      async (
        element: HTMLElement,
        onSelect: (location: Location) => void,
        _onError: (error: unknown) => void,
        options: { initialValue: string; label: string; onInput: (value: string) => void },
      ) => {
        autocompleteSelectors.push(onSelect);
        const input = document.createElement('input');
        input.setAttribute('aria-label', options.label);
        input.value = options.initialValue;
        input.addEventListener('input', () => options.onInput(input.value));
        element.replaceChildren(input);
        const cleanup = Object.assign(
          vi.fn(() => input.remove()),
          {
            setValue: vi.fn((value: string) => {
              input.value = value;
            }),
          },
        );
        autocompleteCleanups.push(cleanup);
        return cleanup;
      },
    );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SmartCommutePlanner offline workflows', () => {
  it('calculates three disclosed examples without making a map request', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('13.95');
    expect(screen.getByTestId('cost-hybrid')).toHaveTextContent('20.81');
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('13.00');
    expect(
      screen.getByText(/editable assumptions, not live Google or Auckland Transport data/),
    ).toBeVisible();
    expect(screen.getByText(/not a navigable map/)).toBeVisible();
    expect(google.initializeMap).not.toHaveBeenCalled();
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('updates fuel costs and the deterministic cheapest recommendation', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    changeNumber('Fuel price (NZ$/L)', '5');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('18.62');
    expect(within(screen.getByTestId('route-card-transit')).getByText('Lowest cost')).toBeVisible();
    expect(screen.getByText(/50 minutes longer/)).toBeVisible();
    changeNumber('Fuel consumption (L/100km)', '10');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('22.04');
  });

  it('uses independently edited transit fares for each direction', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    changeNumber('Public transport fare — outbound', '1');
    changeNumber('Public transport fare — return', '2');
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('3.00');
    expect(within(screen.getByTestId('route-card-transit')).getByText('Lowest cost')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('1.00');
  });

  it('excludes a cleared return from rankings and projections until the user chooses a one-way trip', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    changeNumber('Public transport fare — outbound', '1');
    changeNumber('Public transport fare — return', '2');
    fireEvent.click(screen.getByTestId('route-card-transit'));
    const returnDetails = screen
      .getByTestId('route-editor-transit')
      .querySelectorAll('.sc-direction')[1] as HTMLDetailsElement;
    returnDetails.open = true;
    fireEvent.click(within(returnDetails).getByRole('button', { name: 'Remove segment' }));
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('route-card-drive')).getByText('Lowest cost')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('excluded from round-trip comparisons');
    expect(screen.getByRole('alert')).toHaveTextContent('Bus / public transport');
    expect(screen.getByText('Your monthly commute').closest('.sc-projection')).toHaveTextContent(
      '301.93',
    );
    goTo('Comparison');
    expect(
      within(screen.getByRole('table')).queryByText('Bus / public transport'),
    ).not.toBeInTheDocument();
    goTo('Planner');
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('1.00');
    expect(within(screen.getByTestId('route-card-transit')).getByText('Lowest cost')).toBeVisible();
    expect(screen.queryByText(/excluded from round-trip comparisons/)).not.toBeInTheDocument();
  });

  it('shows no rankings or monthly totals when every round-trip option lacks a return', () => {
    localStorage.setItem(
      'smart-commute-nz:v1',
      JSON.stringify({
        origin: { label: '4 Fong Road, Auckland' },
        destination: { label: defaultProps.destination },
        settings: DEFAULT_SETTINGS,
        options: createExampleOptions().map((option) => ({ ...option, inbound: [] })),
      }),
    );
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
    expect(screen.queryByText('Your monthly commute')).not.toBeInTheDocument();
    expect(screen.queryByText('How the options compare')).not.toBeInTheDocument();
    expect(screen.getByText('Add a return journey to compare complete round trips.')).toBeVisible();
    goTo('Comparison');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Add a return journey to compare complete round trips.')).toBeVisible();
    goTo('Cost breakdown');
    expect(screen.queryByText('Cost composition')).not.toBeInTheDocument();
    goTo('Planner');
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(3);
  });

  it('preserves an explicitly entered walking return instead of inventing a missing transit boarding', () => {
    const options = createExampleOptions();
    options.find((option) => option.id === 'transit')!.inbound = [
      { mode: 'walk', durationMinutes: 120, distanceKm: 8, source: 'manual', estimated: true },
    ];
    localStorage.setItem(
      'smart-commute-nz:v1',
      JSON.stringify({
        origin: { label: '4 Fong Road, Auckland' },
        destination: { label: defaultProps.destination },
        settings: DEFAULT_SETTINGS,
        options,
      }),
    );
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('6.50');
    expect(screen.getByTestId('route-card-transit')).toHaveTextContent('180 min');
    expect(screen.queryByText(/excluded from round-trip comparisons/)).not.toBeInTheDocument();
  });

  it('requires a fresh parking acknowledgment after changing the interchange or its charge', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drive + train' }));
    const acknowledgment = screen.getByLabelText(
      'I have checked station parking rules and the entered charge.',
    );
    fireEvent.click(acknowledgment);
    expect(acknowledgment).toBeChecked();
    expect(
      within(screen.getByTestId('route-card-hybrid')).queryByText(
        'Parking price and permission have not been verified.',
      ),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Interchange / station', { exact: true }), {
      target: { value: 'Panmure' },
    });
    expect(acknowledgment).not.toBeChecked();
    expect(
      within(screen.getByTestId('route-card-hybrid')).getByText(
        'Parking price and permission have not been verified.',
      ),
    ).toBeVisible();
    fireEvent.click(acknowledgment);
    changeNumber('Station parking per commute (NZ$)', '8');
    expect(acknowledgment).not.toBeChecked();
    expect(screen.getByTestId('cost-hybrid')).toHaveTextContent('28.81');
  });

  it('excludes an old free SuperGold fare after crossing the tag-on threshold until explicitly reapplied', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    prepareATTransit(true);
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('0.00');
    fireEvent.click(screen.getByTestId('route-card-transit'));
    fireEvent.change(screen.getByLabelText('Departure time', { exact: true }), {
      target: { value: localDateTime('2026-10-08T08:59:00+13:00') },
    });
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('excluded until you apply a new estimate');
    expect(within(screen.getByTestId('route-card-drive')).getByText('Lowest cost')).toBeVisible();
    expect(screen.getByText('Your monthly commute').closest('.sc-projection')).toHaveTextContent(
      '301.93',
    );
    expect(screen.getByText(/Your estimated tag-on time has changed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Apply AT fare estimate' }));
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('4.90');
    expect(screen.queryByText(/excluded until you apply a new estimate/)).not.toBeInTheDocument();
  });

  it('invalidates AT fares and zone confirmation when an endpoint changes, with explicit manual-fare recovery', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    prepareATTransit();
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('9.80');
    fireEvent.change(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'Newmarket, Auckland' },
    });
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('I have verified these fare zones in the official AT Journey Planner.'),
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply AT fare estimate' })).toBeDisabled();
    changeNumber('Public transport fare — outbound', '2');
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
    changeNumber('Public transport fare — return', '3');
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('5.00');
    // Every option is now manually priced, so the source is stated once for the list.
    expect(screen.getByTestId('route-card-transit')).not.toHaveTextContent('AT fare estimate');
    expect(screen.getByText('Data: Manual')).toBeVisible();
  });

  it('requires fresh AT verification after reload without persisting quote-context metadata', () => {
    const { unmount } = render(<SmartCommutePlanner {...defaultProps} />);
    prepareATTransit();
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('9.80');
    expect(localStorage.getItem('smart-commute-nz:v1')).not.toContain('atFareContexts');
    unmount();
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('restored without verification');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('13.95');
  });

  it('preserves AT provenance when a non-fare input changes so an old discount cannot become a manual assumption', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    prepareATTransit(true);
    const outbound = screen
      .getByTestId('route-editor-transit')
      .querySelector('.sc-direction') as HTMLElement;
    fireEvent.change(within(outbound).getByLabelText('Bus time (min)', { exact: true }), {
      target: { value: '61' },
    });
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no longer match the verified journey');
    fireEvent.click(screen.getByRole('button', { name: 'Apply AT fare estimate' }));
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('0.00');
  });

  it('preserves the last valid settings when a numeric input becomes invalid', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    changeNumber('Fuel price (NZ$/L)', '4');
    const lastValid = localStorage.getItem('smart-commute-nz:v1');
    changeNumber('Fuel price (NZ$/L)', '-1');
    expect(screen.getByLabelText('Fuel price (NZ$/L)', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted inputs');
    expect(screen.queryByTestId('cost-drive')).not.toBeInTheDocument();
    expect(localStorage.getItem('smart-commute-nz:v1')).toBe(lastValid);
    changeNumber('Fuel price (NZ$/L)', '0');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('3.04');
  });

  it('saves a waypoint as a preference and restores it with fuel settings', () => {
    const { unmount } = render(<SmartCommutePlanner {...defaultProps} />);
    changeNumber('Fuel price (NZ$/L)', '4.2');
    fireEvent.change(screen.getByLabelText('Waypoints', { exact: true }), {
      target: { value: 'Sylvia Park' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add waypoint' }));
    expect(
      within(screen.getByTestId('route-editor-drive')).getByText('Sylvia Park'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Outbound distance (km)', { exact: true })).toHaveValue(19);
    unmount();
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByLabelText('Fuel price (NZ$/L)', { exact: true })).toHaveValue(4.2);
    expect(
      within(screen.getByTestId('route-editor-drive')).getByText('Sylvia Park'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove waypoint Sylvia Park' }));
    expect(
      within(screen.getByTestId('route-editor-drive')).queryByText('Sylvia Park'),
    ).not.toBeInTheDocument();
  });

  it('switches the interface to Simplified Chinese while retaining costs', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Language', { exact: true }), {
      target: { value: 'zh-CN' },
    });
    expect(screen.getByRole('tab', { name: '路线规划' })).toBeVisible();
    expect(screen.getByLabelText('汽油单价 (NZ$/L)', { exact: true })).toHaveValue(3.5);
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('13.95');
    expect(screen.getByText(/均为可编辑的假设/)).toBeVisible();
  });

  it('passes an explained calculated result to the embed callback', () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    render(<SmartCommutePlanner {...defaultProps} onRouteSelected={onRouteSelected} />);
    fireEvent.click(screen.getByTestId('route-card-hybrid'));
    expect(onRouteSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'hybrid',
        totalCost: expect.closeTo(20.81, 4),
        warnings: expect.arrayContaining(['unverified-parking']),
      }),
    );
    goTo('Cost breakdown');
    expect(screen.getByText('Parking price and permission have not been verified.')).toBeVisible();
  });

  it('recovers safely from corrupt local storage', () => {
    localStorage.setItem('smart-commute-nz:v1', '{broken');
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('13.95');
  });

  it('compares a custom driving alternative and allows saved route restoration', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a driving alternative' }));
    const editor = screen
      .getByLabelText('Route name', { exact: true })
      .closest('.sc-option-editor') as HTMLElement;
    fireEvent.change(within(editor).getByLabelText(/Outbound distance/), {
      target: { value: '5' },
    });
    expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(4);
    fireEvent.click(within(editor).getByRole('button', { name: 'Save this route' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Remove route' }));
    expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /Load saved route Driving alternative 2/ }));
    expect(screen.getAllByTestId(/^route-card-/)).toHaveLength(4);
  });
});

describe('optional Google provider safeguards', () => {
  it('initializes one map and one pair of address widgets in StrictMode, including a tab return', async () => {
    render(
      <StrictMode>
        <SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />
      </StrictMode>,
    );
    await waitFor(() => expect(google.initializeMap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Plan route' })).toBeEnabled());
    expect(screen.getAllByLabelText('Starting point', { exact: true })).toHaveLength(1);
    expect(screen.getAllByLabelText('Destination', { exact: true })).toHaveLength(1);
    expect(google.getRoutes).not.toHaveBeenCalled();
    expect(google.dispose).not.toHaveBeenCalled();
    const mapElement = google.initializeMap.mock.calls[0]![0] as HTMLElement;
    goTo('Comparison');
    goTo('Planner');
    await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(4));
    expect(mapElement.isConnected).toBe(true);
    expect(google.initializeMap).toHaveBeenCalledTimes(1);
    expect(screen.getAllByLabelText('Starting point', { exact: true })).toHaveLength(1);
    expect(screen.getAllByLabelText('Destination', { exact: true })).toHaveLength(1);
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('loads the map and both primary address inputs automatically without requesting a route', async () => {
    await renderGooglePlanner();
    expect(screen.queryByRole('button', { name: 'Load Google map' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enable Google address search' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/I understand Google Maps and route requests may incur charges/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Starting point', { exact: true })).toHaveLength(1);
    expect(screen.getAllByLabelText('Destination', { exact: true })).toHaveLength(1);
    expect(screen.getByLabelText('Starting point', { exact: true })).toHaveValue(
      '4 Fong Road, Auckland',
    );
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue(
      defaultProps.destination,
    );
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('falls back to editable manual assumptions after a map failure and allows reconnection', async () => {
    google.initializeMap.mockRejectedValueOnce(new Error('Quota exceeded'));
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Google Maps could not complete this request',
      ),
    );
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('13.95');
    expect(screen.getByLabelText('Outbound distance (km)', { exact: true })).toBeEnabled();
    expect(google.getRoutes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Google map' }));
    await waitFor(() => expect(google.initializeMap).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(2));
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('keeps Google distances read-only and never stores geometry when its cost assumptions change', async () => {
    google.getRoutes.mockResolvedValueOnce(liveResponse('google-drive-test', true));
    await renderGooglePlanner();
    planRoute();
    await waitFor(() =>
      expect(screen.getByTestId('route-editor-google-drive-test')).toBeInTheDocument(),
    );
    expect(screen.getByText('Traffic is not included in these durations.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Transit agency' })).toHaveAttribute(
      'href',
      'https://at.govt.nz/',
    );
    const editor = screen.getByTestId('route-editor-google-drive-test');
    const outboundTime = within(editor).getByLabelText('Outbound travel time (min)', {
      exact: true,
    });
    const outboundDistance = within(editor).getByLabelText(/Outbound distance \(km\)/);
    expect(outboundTime).toHaveAttribute('readonly');
    expect(outboundDistance).toHaveAttribute('readonly');
    changeNumber('Parking per commute (NZ$)', '3');
    const stored = JSON.parse(localStorage.getItem('smart-commute-nz:v1')!) as {
      options: { id: string }[];
      savedRoutes: unknown[];
    };
    expect(stored.options.every((option) => !option.id.startsWith('google-'))).toBe(true);
    expect(
      within(editor).queryByRole('button', { name: 'Save this route' }),
    ).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'Remove route' })).not.toBeInTheDocument();
  });

  it('keeps the initialized map DOM across tabs without another billed initialization', async () => {
    await renderGooglePlanner();
    const mapElement = google.initializeMap.mock.calls[0]![0] as HTMLElement;
    goTo('Comparison');
    goTo('Planner');
    await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(4));
    expect(mapElement.isConnected).toBe(true);
    expect(google.initializeMap).toHaveBeenCalledTimes(1);
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('does not persist Google Places content or allow saving it as a manual place', async () => {
    await renderGooglePlanner();
    act(() =>
      autocompleteSelectors[0]!({
        label: 'Google supplied address',
        coordinates: { lat: -36.85, lng: 174.75 },
      }),
    );
    expect(screen.getByLabelText('Starting point', { exact: true })).toHaveValue(
      'Google supplied address',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save starting point' }));
    expect(localStorage.getItem('smart-commute-nz:v1')).not.toContain('Google supplied address');
    expect(screen.getByRole('status')).toHaveTextContent('session-only');
  });

  it('replaces saved times that have already passed before a traffic-aware request', async () => {
    const past = localDateTime(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    localStorage.setItem(
      'smart-commute-nz:v1',
      JSON.stringify({
        origin: { label: '4 Fong Road, Auckland' },
        destination: { label: defaultProps.destination },
        settings: DEFAULT_SETTINGS,
        options: createExampleOptions(),
        leaveNow: false,
        departure: past,
        returnTime: past,
      }),
    );
    await renderGooglePlanner();
    expect(screen.getByLabelText('Leave now', { exact: true })).toBeChecked();
    const returnTime = screen.getByLabelText('Return time', { exact: true }) as HTMLInputElement;
    expect(new Date(returnTime.value).getTime()).toBeGreaterThan(Date.now());
  });

  it('sends an explicit transit lookup with no driving waypoints', async () => {
    google.getRoutes.mockRejectedValueOnce(new Error('No complete NZD fare was returned.'));
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Google Maps could not complete this request',
      ),
    );
    expect(google.getRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'transit', waypoints: [] }),
    );
    expect(screen.queryByTestId('cost-transit')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
  });

  it('keeps Google transit geometry read-only while manual fare changes update cost without another route request', async () => {
    const response = liveResponse('google-transit');
    google.getRoutes.mockResolvedValueOnce({
      ...response,
      routes: [
        {
          ...response.routes[0],
          name: 'Google public transport route',
          mode: 'transit',
          outbound: [
            {
              mode: 'bus',
              durationMinutes: 25,
              distanceKm: 10,
              fare: 6.5,
              transfers: 1,
              source: 'google',
              estimated: true,
            },
          ],
        },
      ],
    });
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    await waitFor(() =>
      expect(screen.getByTestId('cost-google-transit')).toHaveTextContent('6.50'),
    );
    const editor = screen.getByTestId('route-editor-google-transit');
    expect(within(editor).getByLabelText('Segment type', { exact: true })).toHaveAttribute(
      'readonly',
    );
    expect(within(editor).getByLabelText('Bus time (min)', { exact: true })).toHaveAttribute(
      'readonly',
    );
    expect(within(editor).getByLabelText('Transfers', { exact: true })).toHaveAttribute('readonly');
    expect(
      within(editor).queryByRole('combobox', { name: 'Segment type' }),
    ).not.toBeInTheDocument();
    expect(
      within(editor).queryByRole('button', { name: 'Remove segment' }),
    ).not.toBeInTheDocument();
    expect(
      within(editor).queryByRole('button', { name: 'Add transit segment' }),
    ).not.toBeInTheDocument();
    const fare = within(editor).getByLabelText('Public transport fare — outbound', { exact: true });
    expect(fare).toBeEnabled();
    expect(fare).not.toHaveAttribute('readonly');
    vi.useFakeTimers();
    fireEvent.change(fare, { target: { value: '3' } });
    expect(screen.getByTestId('cost-google-transit')).toHaveTextContent('3.00');
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('route-card-transit')).not.toBeInTheDocument();
  });

  it('synchronizes selected Places, swapped endpoints and host updates with the primary address inputs', async () => {
    const { rerender } = await renderGooglePlanner();
    const origin = {
      label: 'Selected home, Auckland',
      coordinates: { lat: -36.9, lng: 174.8 },
    };
    const destination = {
      label: 'Selected work, Auckland',
      coordinates: { lat: -36.85, lng: 174.75 },
    };
    act(() => {
      autocompleteSelectors[0]!(origin);
      autocompleteSelectors[1]!(destination);
    });
    expect(screen.getByLabelText('Starting point', { exact: true })).toHaveValue(origin.label);
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue(destination.label);
    useOneWay();
    planRoute();
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin, destination }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Swap origin and destination' }));
    expect(screen.getByLabelText('Starting point', { exact: true })).toHaveValue(destination.label);
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue(origin.label);
    rerender(
      <SmartCommutePlanner
        origin="Host supplied home"
        destination="Host supplied work"
        googleApiKey="restricted-test-key"
      />,
    );
    expect(screen.getByLabelText('Starting point', { exact: true })).toHaveValue(
      'Host supplied home',
    );
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue('Host supplied work');
    expect(google.attachAutocomplete).toHaveBeenCalledTimes(2);
  });

  it('recalculates the live route cost as fuel, consumption, parking and tolls change without another route request', async () => {
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    await waitFor(() =>
      expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('3.67'),
    );
    vi.useFakeTimers();
    changeNumber('Fuel price (NZ$/L)', '5');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('4.90');
    changeNumber('Fuel consumption (L/100km)', '10');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('5.80');
    changeNumber('Parking per commute (NZ$)', '3');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('8.80');
    changeNumber('Outbound tolls (NZ$)', '2');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('10.80');
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('route-card-drive')).not.toBeInTheDocument();
  });

  it('removes stale results immediately and debounces repeated endpoint edits into one current request', async () => {
    google.getRoutes
      .mockResolvedValueOnce(liveResponse('google-original'))
      .mockResolvedValueOnce(liveResponse('google-updated'));
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    await waitFor(() =>
      expect(screen.getByTestId('route-card-google-original')).toBeInTheDocument(),
    );
    vi.useFakeTimers();
    fireEvent.input(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'New' },
    });
    expect(screen.queryByTestId('route-card-google-original')).not.toBeInTheDocument();
    expect(google.clearMapRoutes).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    fireEvent.input(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'Newmarket, Auckland' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(799));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(google.getRoutes).toHaveBeenCalledTimes(2);
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ destination: { label: 'Newmarket, Auckland' } }),
    );
    expect(screen.getByTestId('route-card-google-updated')).toBeInTheDocument();
    expect(screen.queryByTestId('route-card-drive')).not.toBeInTheDocument();
  });

  it('uses manual input while offline and reconnects without replacing cost preferences or initializing a second map', async () => {
    await renderGooglePlanner();
    changeNumber('Fuel price (NZ$/L)', '5');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    expect(
      screen.getByText('You are offline. Manual calculation remains available.'),
    ).toBeVisible();
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('18.62');
    expect(screen.getByLabelText('Fuel price (NZ$/L)', { exact: true })).toHaveValue(5);
    fireEvent.change(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'Entered offline' },
    });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(4));
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue('Entered offline');
    expect(screen.getByLabelText('Fuel price (NZ$/L)', { exact: true })).toHaveValue(5);
    expect(google.initializeMap).toHaveBeenCalledTimes(1);
    expect(google.getRoutes).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
    expect(screen.getAllByLabelText('Destination', { exact: true })).toHaveLength(1);
  });

  it('starts in manual mode without loading Google when the browser is already offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    expect(google.initializeMap).not.toHaveBeenCalled();
    expect(google.attachAutocomplete).not.toHaveBeenCalled();
    expect(google.getRoutes).not.toHaveBeenCalled();
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('13.95');
    fireEvent.change(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'Manual offline destination' },
    });
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue(
      'Manual offline destination',
    );
  });

  it('preserves updated manual parking and toll costs when an existing Google route returns online', async () => {
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    await waitFor(() =>
      expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('3.67'),
    );
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('6.97');
    changeNumber('Parking per commute (NZ$)', '4');
    changeNumber('Outbound tolls (NZ$)', '2');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('12.97');
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fireEvent(window, new Event('online'));
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('9.67');
    expect(google.initializeMap).toHaveBeenCalledTimes(1);
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('route-card-drive')).not.toBeInTheDocument();
  });

  it('retains manual fallback when a late Google authorization failure invalidates an in-flight route request', async () => {
    let failMap!: (error: Error) => void;
    let finish!: (response: ReturnType<typeof liveResponse>) => void;
    google.initializeMap.mockImplementationOnce(
      async (_element: HTMLElement, onError: (error: Error) => void) => {
        failMap = onError;
      },
    );
    google.getRoutes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    act(() => failMap(new Error('Google authorization expired')));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Google Maps could not complete this request',
    );
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('6.97');
    await act(async () => finish(liveResponse('google-after-auth-failure')));
    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(screen.queryByTestId('route-card-google-after-auth-failure')).not.toBeInTheDocument();
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('6.97');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Google Maps could not complete this request',
    );
    expect(screen.getByRole('button', { name: 'Reconnect Google map' })).toBeVisible();
    expect(google.initializeMap).toHaveBeenCalledTimes(1);
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    expect(google.attachAutocomplete).toHaveBeenCalledTimes(2);
  });

  it('queues a current endpoint refresh after an obsolete request settles instead of overlapping requests', async () => {
    let finish!: (response: ReturnType<typeof liveResponse>) => void;
    google.getRoutes
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(liveResponse('google-current'));
    await renderGooglePlanner();
    useOneWay();
    vi.useFakeTimers();
    planRoute();
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    fireEvent.input(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'Latest destination' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    await act(async () => finish(liveResponse('google-obsolete')));
    expect(screen.queryByTestId('route-card-google-obsolete')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(google.getRoutes).toHaveBeenCalledTimes(2);
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ destination: { label: 'Latest destination' } }),
    );
    expect(screen.getByTestId('route-card-google-current')).toBeInTheDocument();
  });
});

describe('Google transit fare ranges', () => {
  it('labels an estimated CityLink fare as approximate and uses the CityLink explanation', async () => {
    const response = rangedTransitResponse();
    google.getRoutes.mockResolvedValueOnce({
      ...response,
      routes: response.routes.map((route) => ({
        ...route,
        outbound: route.outbound.map((leg) => ({
          ...leg,
          fareRange: { ...leg.fareRange, min: 0.95, max: 0.95, basis: 'citylink' },
        })),
      })),
    });
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    const cost = await screen.findByTestId('cost-google-transit-range');
    expect(cost).toHaveTextContent('Approx. $0.95');
    const card = screen.getByTestId('route-card-google-transit-range');
    expect(card).toHaveTextContent('Adult CityLink AT HOP/contactless estimate.');
    expect(card).not.toHaveTextContent('unconfirmed fare zones');
  });

  it('shows missing Google fare as an adult AT range across the card, projections, comparison and breakdown', async () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    await planRangedTransit(false, { onRouteSelected });
    expect(google.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ estimateMissingTransitFare: true }),
    );
    expectMoneyRange(screen.getByTestId('cost-google-transit-range'), 3, 7.9);
    const [renderedId, renderOptions] = google.renderRoute.mock.lastCall as [
      string,
      { labels: Record<string, string> },
    ];
    expect(renderedId).toBe('google-transit-range');
    expect(renderOptions.labels['google-transit-range']).toMatch(/min · .*\$3\.00–\$7\.90/);
    expect(google.initializeMap.mock.calls[0]![0].isConnected).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Adjust fares and costs'));
    const editor = screen.getByTestId('route-editor-google-transit-range');
    expect(
      within(editor).getByText(
        'Adult AT HOP/contactless estimate with unconfirmed fare zones. Transfer timing can widen the range. Concessions and fare caps are excluded.',
      ),
    ).toBeVisible();
    expect(within(editor).getByText('12 stops')).toBeVisible();
    const projection = screen
      .getByText('Your monthly commute')
      .closest('.sc-projection') as HTMLElement;
    expectMoneyRange(projection.querySelector('strong')!, 64.95, 171.04);
    fireEvent.click(screen.getByTestId('route-card-google-transit-range'));
    expect(onRouteSelected).toHaveBeenLastCalledWith(
      expect.objectContaining({
        totalCost: 7.9,
        totalCostRange: { min: 3, max: 7.9 },
        warnings: expect.arrayContaining(['fare-range-estimate']),
      }),
    );
    goTo('Comparison');
    const row = within(screen.getByRole('table'))
      .getByRole('button', { name: 'Google public transport route' })
      .closest('tr') as HTMLElement;
    const cells = within(row).getAllByRole('cell');
    expectMoneyRange(cells[1]!, 3, 7.9);
    expectMoneyRange(cells[5]!, 15, 39.5);
    expectMoneyRange(cells[6]!, 64.95, 171.04);
    goTo('Cost breakdown');
    expectMoneyRange(document.querySelector('.sc-breakdown-total strong') as HTMLElement, 3, 7.9);
    expectMoneyRange(
      screen.getByText('Transport fares').closest('div')!.querySelector('dd')!,
      3,
      7.9,
    );
    expectMoneyRange(
      screen
        .getByText('Weekly', { exact: true })
        .closest('.sc-budget-number')!
        .querySelector('strong')!,
      15,
      39.5,
    );
    expectMoneyRange(
      screen
        .getByText('Monthly', { exact: true })
        .closest('.sc-budget-number')!
        .querySelector('strong')!,
      64.95,
      171.04,
    );
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
  });

  it('clears a fare range when a manual fare is entered without changing Google geometry or requesting another route', async () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    await planRangedTransit(false, { onRouteSelected });
    vi.useFakeTimers();
    const editor = screen.getByTestId('route-editor-google-transit-range');
    fireEvent.change(within(editor).getByLabelText('Public transport fare — outbound'), {
      target: { value: '3.4' },
    });
    const cost = screen.getByTestId('cost-google-transit-range');
    expect(cost).toHaveTextContent('3.40');
    expect(cost).not.toHaveTextContent('7.90');
    expect(cost.textContent).not.toMatch(/[–—-]/);
    expect(within(editor).getByLabelText('Bus time (min)')).toHaveAttribute('readonly');
    expect(within(editor).getByLabelText('Transfers')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByTestId('route-card-google-transit-range'));
    const selected = onRouteSelected.mock.lastCall![0];
    expect(selected.totalCost).toBe(3.4);
    expect(selected.totalCostRange).toBeUndefined();
    expect(selected.warnings).not.toContain('fare-range-estimate');
    expect(selected.option.outbound[0]).toMatchObject({
      fare: 3.4,
      source: 'google',
      fareSource: 'manual',
    });
    expect(selected.option.outbound[0]?.fareRange).toBeUndefined();
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    goTo('Cost breakdown');
    const fareTotal = screen.getByText('Transport fares').closest('div')!.querySelector('dd')!;
    expect(fareTotal).toHaveTextContent('3.40');
    expect(fareTotal.textContent).not.toMatch(/[–—-]/);
  });

  it('restores the original estimate when a confirmed journey fare is cleared without requesting another route', async () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    await planRangedTransit(false, { onRouteSelected });
    vi.useFakeTimers();
    changeNumber('Public transport fare — outbound', '4.9');
    expect(screen.getByTestId('cost-google-transit-range')).toHaveTextContent('4.90');
    changeNumber('Public transport fare — outbound', '');
    expectMoneyRange(screen.getByTestId('cost-google-transit-range'), 3, 7.9);
    const input = screen.getByLabelText('Public transport fare — outbound');
    expect(input).toHaveValue(null);
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByTestId('route-card-google-transit-range'));
    const restored = onRouteSelected.mock.lastCall![0];
    expect(restored.totalCostRange).toEqual({ min: 3, max: 7.9 });
    expect(restored.warnings).toContain('fare-range-estimate');
    expect(restored.option.outbound[0]).toMatchObject({
      source: 'google',
      fareSource: 'at-estimate',
      fareRange: { min: 3, max: 7.9 },
    });
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
  });

  it('combines outbound and return ranges independently and clears each one only after its fare is overridden', async () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    await planRangedTransit(true, { onRouteSelected });
    expectMoneyRange(screen.getByTestId('cost-google-transit-range'), 7.9, 14.4);
    changeNumber('Public transport fare — outbound', '2');
    expectMoneyRange(screen.getByTestId('cost-google-transit-range'), 6.9, 8.5);
    fireEvent.click(screen.getByTestId('route-card-google-transit-range'));
    const partiallyPriced = onRouteSelected.mock.lastCall![0];
    expect(partiallyPriced.option.outbound[0]?.fareRange).toBeUndefined();
    expect(partiallyPriced.option.inbound[0]?.fareRange).toMatchObject({ min: 4.9, max: 6.5 });
    expect(partiallyPriced.breakdown.outbound.totalCostRange).toBeUndefined();
    expect(partiallyPriced.breakdown.inbound.totalCostRange).toEqual({ min: 4.9, max: 6.5 });
    changeNumber('Public transport fare — return', '3');
    const cost = screen.getByTestId('cost-google-transit-range');
    expect(cost).toHaveTextContent('5.00');
    expect(cost.textContent).not.toMatch(/[–—-]/);
    fireEvent.click(screen.getByTestId('route-card-google-transit-range'));
    expect(onRouteSelected.mock.lastCall![0].totalCostRange).toBeUndefined();
    expect(onRouteSelected.mock.lastCall![0].warnings).not.toContain('fare-range-estimate');
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
  });

  it('uses verified AT zones to replace a range while keeping the Google transit route read-only', async () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    await planRangedTransit(true, { onRouteSelected });
    fireEvent.click(screen.getByText('Estimate with AT fare rules', { exact: true }));
    expect(screen.getByLabelText('Outbound verified zones')).toHaveValue('');
    expect(screen.getByLabelText('Return verified zones')).toHaveValue('');
    expect(
      screen.getByLabelText('I have verified these fare zones in the official AT Journey Planner.'),
    ).not.toBeChecked();
    changeNumber('Outbound verified zones', '2');
    changeNumber('Return verified zones', '1');
    fireEvent.click(
      screen.getByLabelText('I have verified these fare zones in the official AT Journey Planner.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply AT fare estimate' }));
    const cost = screen.getByTestId('cost-google-transit-range');
    expect(cost).toHaveTextContent('7.90');
    expect(cost.textContent).not.toMatch(/[–—-]/);
    fireEvent.click(screen.getByTestId('route-card-google-transit-range'));
    const verified = onRouteSelected.mock.lastCall![0];
    expect(verified.totalCostRange).toBeUndefined();
    expect(verified.option.outbound[0]).toMatchObject({
      fare: 4.9,
      source: 'google',
      fareSource: 'at-rule',
    });
    expect(verified.option.inbound[0]).toMatchObject({
      fare: 3,
      source: 'google',
      fareSource: 'at-rule',
    });
    expect(verified.option.outbound[0]?.fareRange).toBeUndefined();
    expect(verified.option.inbound[0]?.fareRange).toBeUndefined();
    const editor = screen.getByTestId('route-editor-google-transit-range');
    expect(within(editor).getAllByLabelText('Bus time (min)')).toHaveLength(2);
    for (const input of within(editor).getAllByLabelText('Bus time (min)'))
      expect(input).toHaveAttribute('readonly');
    expect(
      within(editor).queryByRole('button', { name: 'Add transit segment' }),
    ).not.toBeInTheDocument();
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
  });

  it('shows a pricing requirement for an unknown transit operator without inventing a free route or disabling the map', async () => {
    google.getRoutes.mockRejectedValueOnce(
      new Error(
        'This transit operator has no supported fare estimate. Enter a verified manual fare.',
      ),
    );
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Google Maps could not complete this request',
      ),
    );
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
    expect(screen.queryByText('Your monthly commute')).not.toBeInTheDocument();
    expect(google.initializeMap.mock.calls[0]![0].isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'Plan route' })).toBeEnabled();
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
  });
});

describe('Google intermediate stops', () => {
  it('selects ordered Places stops before the first route query and cleans up each stop input', async () => {
    await renderGooglePlanner();
    useOneWay();
    const first = { label: 'First selected stop', coordinates: { lat: -36.9, lng: 174.8 } };
    const second = { label: 'Second selected stop', coordinates: { lat: -36.87, lng: 174.77 } };
    const firstCleanup = await addGoogleStop(first);
    const secondCleanup = await addGoogleStop(second);
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Search an intermediate stop')).not.toBeInTheDocument();
    expect(google.getRoutes).not.toHaveBeenCalled();
    planRoute();
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'drive', waypoints: [first, second] }),
    );
    expect(localStorage.getItem('smart-commute-nz:v1')).not.toContain(first.label);
    expect(localStorage.getItem('smart-commute-nz:v1')).not.toContain(second.label);
  });

  it('refreshes the route with ordered stops after a move or removal without issuing overlapping immediate queries', async () => {
    await renderGooglePlanner();
    useOneWay();
    const first = { label: 'First stop' };
    const second = { label: 'Second stop' };
    await addGoogleStop(first);
    await addGoogleStop(second);
    planRoute();
    await waitFor(() =>
      expect(screen.getByTestId('route-card-google-drive-test')).toBeInTheDocument(),
    );
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Move stop earlier Second stop' }));
    expect(screen.queryByTestId('route-card-google-drive-test')).not.toBeInTheDocument();
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(799));
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(google.getRoutes).toHaveBeenCalledTimes(2);
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ waypoints: [second, first] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove waypoint Second stop' }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(google.getRoutes).toHaveBeenCalledTimes(3);
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ waypoints: [first] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove waypoint First stop' }));
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(google.getRoutes).toHaveBeenCalledTimes(4);
    expect(google.getRoutes).toHaveBeenLastCalledWith(expect.objectContaining({ waypoints: [] }));
  });

  it('refreshes an already planned route after a new stop is selected', async () => {
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    await waitFor(() =>
      expect(screen.getByTestId('route-card-google-drive-test')).toBeInTheDocument(),
    );
    const stop = { label: 'Added after planning', coordinates: { lat: -36.91, lng: 174.85 } };
    await addGoogleStop(stop);
    expect(screen.queryByTestId('route-card-google-drive-test')).not.toBeInTheDocument();
    expect(google.getRoutes).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(2));
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ waypoints: [stop] }),
    );
  });

  it('limits the trip to ten stops and lets removal reopen the stop and map controls', async () => {
    await renderGooglePlanner();
    for (let index = 0; index < 10; index += 1) {
      await addGoogleStop({ label: `Stop ${index + 1}` });
    }
    expect(screen.getByRole('button', { name: 'Add stop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add stop on map' })).toBeDisabled();
    expect(google.getRoutes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove waypoint Stop 5' }));
    expect(screen.getByRole('button', { name: 'Add stop' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add stop on map' })).toBeEnabled();
    await addGoogleStop({ label: 'Replacement stop' });
    useOneWay();
    planRoute();
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        waypoints: [
          ...Array.from({ length: 4 }, (_, index) => ({ label: `Stop ${index + 1}` })),
          ...Array.from({ length: 5 }, (_, index) => ({ label: `Stop ${index + 6}` })),
          { label: 'Replacement stop' },
        ],
      }),
    );
  });

  it('blocks public transport planning with stops instead of silently discarding them', async () => {
    await renderGooglePlanner();
    await addGoogleStop({ label: 'Required stop' });
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    expect(
      screen.getByText(
        'Google public transport routes do not support intermediate stops. Remove them or switch to driving before planning.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Plan route' })).toBeDisabled();
    expect(google.getRoutes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove waypoint Required stop' }));
    expect(screen.getByRole('button', { name: 'Plan route' })).toBeEnabled();
  });

  it('cleans up a stop search across tabs and restores the visible draft before adding it', async () => {
    await renderGooglePlanner();
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    const draftInput = await screen.findByLabelText('Search an intermediate stop');
    fireEvent.input(draftInput, { target: { value: 'Retained typed stop' } });
    const cleanup = autocompleteCleanups[autocompleteCleanups.length - 1]!;
    goTo('Comparison');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Search an intermediate stop')).not.toBeInTheDocument();
    goTo('Planner');
    await waitFor(() =>
      expect(screen.getAllByLabelText('Starting point', { exact: true })).toHaveLength(1),
    );
    expect(screen.getAllByLabelText('Destination', { exact: true })).toHaveLength(1);
    expect(await screen.findByLabelText('Search an intermediate stop')).toHaveValue(
      'Retained typed stop',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    expect(
      screen.getByRole('button', { name: 'Remove waypoint Retained typed stop' }),
    ).toBeVisible();
    expect(google.getRoutes).not.toHaveBeenCalled();
    useOneWay();
    planRoute();
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ waypoints: [{ label: 'Retained typed stop' }] }),
    );
  });

  it('adds a clicked map stop once and cancels map selection after the pick', async () => {
    let pick!: (coordinates: { lat: number; lng: number }) => void;
    const cleanup = vi.fn();
    google.beginWaypointSelection.mockImplementationOnce((onPick: typeof pick) => {
      pick = (coordinates) => {
        cleanup();
        onPick(coordinates);
      };
      return cleanup;
    });
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Add stop on map' }));
    expect(screen.getByRole('button', { name: 'Cancel map selection' })).toBeVisible();
    const coordinates = { lat: -36.9, lng: 174.8 };
    act(() => pick(coordinates));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Cancel map selection' })).not.toBeInTheDocument();
    planRoute();
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        waypoints: [
          expect.objectContaining({ label: expect.stringContaining('Map stop 1'), coordinates }),
        ],
      }),
    );
    expect(google.renderWaypointMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ coordinates }),
    ]);
  });
});

describe('component host updates', () => {
  it('reacts to changed host destination, origin and fuel parameters after mount', () => {
    const { rerender } = render(
      <SmartCommutePlanner destination="Britomart" origin="Home" fuelPrice={3.5} />,
    );
    rerender(
      <SmartCommutePlanner
        destination={{ label: 'Panmure' }}
        origin={{ label: 'New home' }}
        fuelPrice={5}
        fuelConsumption={10}
      />,
    );
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue('Panmure');
    expect(screen.getByLabelText('Starting point', { exact: true })).toHaveValue('New home');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('22.04');
  });

  it('discards an in-flight Google result when the destination changes', async () => {
    let finish!: (response: unknown) => void;
    google.getRoutes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    fireEvent.input(screen.getByLabelText('Destination', { exact: true }), {
      target: { value: 'Changed destination' },
    });
    await act(async () =>
      finish({
        routes: [
          {
            id: 'google-stale',
            name: 'Old route',
            mode: 'drive',
            outbound: [
              {
                mode: 'drive',
                distanceKm: 99,
                durationMinutes: 99,
                source: 'google',
                estimated: true,
              },
            ],
            inbound: [],
            parkingCost: 0,
            waypoints: [],
          },
        ],
        warnings: [],
        attribution: 'Google Maps',
        requestCount: 1,
      }),
    );
    expect(screen.queryByTestId('route-card-google-stale')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue(
      'Changed destination',
    );
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
  });

  it('removes one-way live results when round-trip requirements change', async () => {
    google.getRoutes.mockResolvedValueOnce({
      routes: [
        {
          id: 'google-oneway',
          name: 'One way',
          mode: 'drive',
          outbound: [
            {
              mode: 'drive',
              distanceKm: 9,
              durationMinutes: 20,
              source: 'google',
              estimated: true,
            },
          ],
          inbound: [],
          parkingCost: 0,
          waypoints: [],
        },
      ],
      warnings: [],
      attribution: 'Google Maps',
      requestCount: 1,
    });
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    await waitFor(() => expect(screen.getByTestId('route-card-google-oneway')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    expect(screen.queryByTestId('route-card-google-oneway')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^route-card-/)).toHaveLength(0);
  });
});

describe('result meaning and input feedback', () => {
  it('distinguishes missing and partial distances from a real zero', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByTestId('route-card-transit')).toHaveTextContent('Distance not entered');
    expect(screen.getByTestId('route-card-transit')).not.toHaveTextContent('0 km');
    expect(screen.getByTestId('route-card-hybrid')).toHaveTextContent('At least 30 km');
    changeNumber('Outbound distance (km)', '0');
    changeNumber('Return distance (km)', '0');
    expect(screen.getByTestId('route-card-drive')).toHaveTextContent('0 km');
  });

  it('marks the specific missing place and links its message', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Starting point', { exact: true }), {
      target: { value: '' },
    });
    const origin = screen.getByLabelText('Starting point', { exact: true });
    expect(origin).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(origin.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Enter a starting point.',
    );
    expect(screen.getByLabelText('Destination', { exact: true })).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('requires a date for a scheduled departure', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Leave now', { exact: true }));
    const departure = screen.getByLabelText('Departure time', { exact: true });
    expect(departure).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Choose a departure date and time/)).toBeVisible();
    fireEvent.change(departure, { target: { value: '2026-10-12T08:00' } });
    expect(departure).not.toHaveAttribute('aria-invalid');
  });

  it('labels time value amounts as per-commute figures', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    goTo('Cost breakdown');
    expect(screen.getByText('Time value per commute')).toBeVisible();
    expect(screen.getByText('Cost + time value per commute')).toBeVisible();
  });

  it('explains Google failures in the selected language with a next step', async () => {
    google.getRoutes.mockRejectedValueOnce(
      new RouteProviderError('NETWORK_ERROR', 'Google could not complete the request.'),
    );
    await renderGooglePlanner();
    useOneWay();
    fireEvent.change(screen.getByLabelText('Language', { exact: true }), {
      target: { value: 'zh-CN' },
    });
    fireEvent.click(screen.getByRole('button', { name: '规划路线' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('无法连接 Google 地图'),
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Google could not complete');
  });

  it('shows Auckland departure and arrival times and reorders by time or cost plus time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T07:00:00+13:00'));
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByTestId('route-card-drive')).toHaveTextContent('07:00 → 07:35');
    expect(screen.getByTestId('route-card-transit')).toHaveTextContent('07:00 → 08:00');
    const order = () =>
      screen
        .getAllByTestId(/^route-card-/)
        .map((card) => card.dataset.testid?.replace('route-card-', ''));
    expect(order()).toEqual(['transit', 'drive', 'hybrid']);
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    expect(order()).toEqual(['drive', 'transit', 'hybrid']);
    fireEvent.click(screen.getByRole('button', { name: 'Cost' }));
    changeNumber('Fuel price (NZ$/L)', '9');
    expect(order()[0]).toBe('transit');
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    expect(order()[0]).toBe('drive');
  });

  it('reorders by distance and labels only a fully measured route as shortest', () => {
    render(<SmartCommutePlanner {...defaultProps} />);
    const order = () =>
      screen
        .getAllByTestId(/^route-card-/)
        .map((card) => card.dataset.testid?.replace('route-card-', ''));
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }));
    // Only the full drive has every leg distance; the others are lower bounds and sort after it.
    expect(order()[0]).toBe('drive');
    expect(screen.getByTestId('route-card-drive')).toHaveTextContent('Shortest distance');
    expect(screen.getByTestId('route-card-hybrid')).not.toHaveTextContent('Shortest distance');
  });
});

describe('map destination, automatic planning and stop placement', () => {
  it('sets the destination from one map click and plans the route straight away', async () => {
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Set destination on map' }));
    expect(screen.getByText('Click the map to set the destination, or cancel.')).toBeVisible();
    const pick = google.beginWaypointSelection.mock.lastCall![0] as (coordinates: {
      lat: number;
      lng: number;
    }) => void;
    act(() => pick({ lat: -36.9, lng: 174.8 }));
    expect(screen.getByLabelText('Destination', { exact: true })).toHaveValue(
      'Map destination (-36.90000, 174.80000)',
    );
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes.mock.lastCall![0]).toMatchObject({
      destination: { coordinates: { lat: -36.9, lng: 174.8 } },
      mode: 'drive',
    });
  });

  it('plans again when the travel mode changes, without repeating a current request', async () => {
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    expect(google.getRoutes.mock.lastCall![0]).toMatchObject({ mode: 'transit' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Plan route' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(2));
    expect(google.getRoutes.mock.lastCall![0]).toMatchObject({ mode: 'drive' });
  });

  it('lists driving stops between the starting point and the destination', async () => {
    await renderGooglePlanner();
    const origin = screen.getByLabelText('Starting point', { exact: true });
    const stops = screen.getByRole('region', { name: 'Waypoints' });
    const destination = screen.getByLabelText('Destination', { exact: true });
    expect(origin.compareDocumentPosition(stops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      stops.compareDocumentPosition(destination) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('destination opening hours', () => {
  it('shows when a searched destination is closed on arrival and when it opens next', async () => {
    // Monday 12 October 2026, 20:00 NZDT: a shop open 09:00–17:00 on weekdays is closed.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T20:00:00+13:00'));
    google.getPlaceHours.mockResolvedValue({
      placeId: 'shop',
      periods: [1, 2, 3, 4, 5].map((day) => ({
        open: { day, hour: 9, minute: 0 },
        close: { day, hour: 17, minute: 0 },
      })),
      utcOffsetMinutes: 780,
      fetchedAt: 0,
    });
    await renderGooglePlanner();
    act(() =>
      autocompleteSelectors[1]!({
        label: 'Local shop, Auckland',
        coordinates: { lat: -36.85, lng: 174.76 },
        placeId: 'shop',
      }),
    );
    expect(google.getPlaceHours).toHaveBeenCalledWith('shop');
    expect(
      await screen.findByText('Closed when you arrive (20:00) · opens Tue 09:00'),
    ).toBeVisible();
    expect(google.getPlaceHours).toHaveBeenCalledTimes(1);
  });
});

describe('traffic delay cost', () => {
  it('shows the delay and the fuel it costs on a live driving route', async () => {
    const response = liveResponse('google-traffic');
    Object.assign(response.routes[0]!.outbound[0]!, { congestionMinutes: 15 });
    google.getRoutes.mockResolvedValueOnce(response);
    await renderGooglePlanner();
    useOneWay();
    planRoute();
    const card = await screen.findByTestId('route-card-google-traffic');
    // 15 min at 0.8 L/hour and NZ$3.50/L is NZ$0.70.
    expect(card).toHaveTextContent('About 15 min in traffic · $0.70 extra fuel');
    // 10 km fuel 2.87 + upkeep 0.80 + traffic 0.70.
    expect(screen.getByTestId('cost-google-traffic')).toHaveTextContent('4.37');
  });
});
