import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartCommutePlanner } from './SmartCommutePlanner';
import {
  createExampleOptions,
  DEFAULT_SETTINGS,
  type Location,
  type RouteResult,
} from '@smart-commute/core';

const google = vi.hoisted(() => ({
  initializeMap: vi.fn(),
  getRoutes: vi.fn(),
  renderRoute: vi.fn(),
  dispose: vi.fn(),
  attachAutocomplete: vi.fn(),
  clearMapRoutes: vi.fn(),
}));
vi.mock('@smart-commute/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smart-commute/providers')>()),
  GoogleRouteProvider: class {
    initializeMap = google.initializeMap;
    getRoutes = google.getRoutes;
    renderRoute = google.renderRoute;
    clearMapRoutes = google.clearMapRoutes;
    dispose = google.dispose;
    attachAutocomplete = google.attachAutocomplete;
    getMetrics = () => ({ routeRequests: 1 });
  },
}));

const defaultProps = { destination: 'Britomart, Auckland' };
const autocompleteSelectors: ((place: Location) => void)[] = [];
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
async function renderGooglePlanner() {
  const result = render(
    <SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />,
  );
  await waitFor(() => expect(google.initializeMap).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(google.attachAutocomplete).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Plan route' })).toBeEnabled());
  return result;
}
const useOneWay = () =>
  fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
const planRoute = () => fireEvent.click(screen.getByRole('button', { name: 'Plan route' }));
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
  google.initializeMap.mockReset().mockResolvedValue(undefined);
  google.getRoutes.mockReset().mockResolvedValue(liveResponse());
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
    expect(screen.getByTestId('cost-hybrid')).toHaveTextContent('18.41');
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('15.58');
    expect(within(screen.getByTestId('route-card-transit')).getByText('Lowest cost')).toBeVisible();
    expect(screen.getByText(/50 minutes longer/)).toBeVisible();
    changeNumber('Fuel consumption (L/100km)', '10');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('19.00');
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
      '236.11',
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
    expect(screen.queryByText('A useful starting point')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('cost-hybrid')).toHaveTextContent('26.41');
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
      '236.11',
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
    expect(within(screen.getByTestId('route-card-transit')).getByText('Manual')).toBeVisible();
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('0.00');
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
    expect(screen.getByText(/均为可编辑的假设/)).toBeVisible();
  });

  it('passes an explained calculated result to the embed callback', () => {
    const onRouteSelected = vi.fn<(result: RouteResult) => void>();
    render(<SmartCommutePlanner {...defaultProps} onRouteSelected={onRouteSelected} />);
    fireEvent.click(screen.getByTestId('route-card-hybrid'));
    expect(onRouteSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'hybrid',
        totalCost: expect.closeTo(18.41, 4),
        warnings: expect.arrayContaining(['unverified-parking']),
      }),
    );
    goTo('Cost breakdown');
    expect(screen.getByText('Parking price and permission have not been verified.')).toBeVisible();
  });

  it('recovers safely from corrupt local storage', () => {
    localStorage.setItem('smart-commute-nz:v1', '{broken');
    render(<SmartCommutePlanner {...defaultProps} />);
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
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
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Quota exceeded'));
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
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

  it('sends an explicit transit lookup with no driving waypoints', async () => {
    google.getRoutes.mockRejectedValueOnce(new Error('No complete NZD fare was returned.'));
    await renderGooglePlanner();
    useOneWay();
    fireEvent.click(screen.getByRole('button', { name: 'Public transport' }));
    planRoute();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No complete NZD fare'),
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
    planRoute();
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
    expect(within(editor).queryByRole('combobox')).not.toBeInTheDocument();
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
      expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('2.87'),
    );
    vi.useFakeTimers();
    changeNumber('Fuel price (NZ$/L)', '5');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('4.10');
    changeNumber('Fuel consumption (L/100km)', '10');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('5.00');
    changeNumber('Parking per commute (NZ$)', '3');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('8.00');
    changeNumber('Outbound tolls (NZ$)', '2');
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('10.00');
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('15.58');
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
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
      expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('2.87'),
    );
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('5.45');
    changeNumber('Parking per commute (NZ$)', '4');
    changeNumber('Outbound tolls (NZ$)', '2');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('11.45');
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fireEvent(window, new Event('online'));
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(screen.getByTestId('cost-google-drive-test')).toHaveTextContent('8.87');
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
    expect(screen.getByRole('alert')).toHaveTextContent('Google authorization expired');
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('5.45');
    await act(async () => finish(liveResponse('google-after-auth-failure')));
    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(screen.queryByTestId('route-card-google-after-auth-failure')).not.toBeInTheDocument();
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('5.45');
    expect(screen.getByRole('alert')).toHaveTextContent('Google authorization expired');
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('19.00');
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
