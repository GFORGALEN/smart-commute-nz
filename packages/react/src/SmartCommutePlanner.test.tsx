import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
}));
vi.mock('@smart-commute/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smart-commute/providers')>()),
  GoogleRouteProvider: class {
    initializeMap = google.initializeMap;
    getRoutes = google.getRoutes;
    renderRoute = google.renderRoute;
    clearMapRoutes = vi.fn();
    dispose = google.dispose;
    attachAutocomplete = google.attachAutocomplete;
    getMetrics = () => ({ routeRequests: 1 });
  },
}));

const defaultProps = { destination: 'Britomart, Auckland' };
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
  google.initializeMap.mockResolvedValue(undefined);
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
  it('shows a readable API failure only after explicit billing consent and map action', async () => {
    google.initializeMap.mockRejectedValueOnce(new Error('Quota exceeded'));
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    expect(google.initializeMap).not.toHaveBeenCalled();
    const loadButton = screen.getByRole('button', { name: 'Load Google map' });
    expect(loadButton).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(loadButton);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Google Maps request failed'),
    );
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('never caches Google-derived geometry even when users edit every live leg', async () => {
    google.getRoutes.mockResolvedValueOnce({
      routes: [
        {
          id: 'google-drive-test',
          name: 'Google driving route',
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
          inbound: [
            {
              mode: 'drive',
              distanceKm: 100,
              durationMinutes: 100,
              source: 'google',
              estimated: true,
            },
          ],
          parkingCost: 0,
          waypoints: [],
        },
      ],
      warnings: ['Traffic is not included in these durations.'],
      attribution: 'Google Maps',
      attributionLinks: [{ label: 'Transit agency', url: 'https://at.govt.nz/' }],
      requestCount: 1,
    });
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load Google map' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request Google driving routes' })).toBeVisible(),
    );
    fireEvent.change(screen.getByLabelText('Return time', { exact: true }), {
      target: { value: '2026-10-10T17:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Google driving routes' }));
    await waitFor(() =>
      expect(screen.getByTestId('route-editor-google-drive-test')).toBeInTheDocument(),
    );
    expect(screen.getByText('Traffic is not included in these durations.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Transit agency' })).toHaveAttribute(
      'href',
      'https://at.govt.nz/',
    );
    const editor = screen.getByTestId('route-editor-google-drive-test');
    fireEvent.change(within(editor).getByLabelText('Outbound travel time (min)', { exact: true }), {
      target: { value: '88' },
    });
    fireEvent.change(within(editor).getByLabelText('Return travel time (min)', { exact: true }), {
      target: { value: '89' },
    });
    const stored = JSON.parse(localStorage.getItem('smart-commute-nz:v1')!) as {
      options: { id: string }[];
      savedRoutes: unknown[];
    };
    expect(stored.options.every((option) => !option.id.startsWith('google-'))).toBe(true);
    expect(
      within(editor).queryByRole('button', { name: 'Save this route' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the initialized map DOM across tabs without another billed initialization', async () => {
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load Google map' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request Google driving routes' })).toBeVisible(),
    );
    const mapElement = google.initializeMap.mock.calls[0]![0] as HTMLElement;
    goTo('Comparison');
    goTo('Planner');
    expect(mapElement.isConnected).toBe(true);
    expect(google.initializeMap).toHaveBeenCalledTimes(1);
    expect(google.getRoutes).not.toHaveBeenCalled();
  });

  it('does not persist Google Places content or allow saving it as a manual place', async () => {
    const selectors: ((place: Location) => void)[] = [];
    google.attachAutocomplete.mockImplementation(
      async (_element: HTMLElement, onSelect: (location: Location) => void) => {
        selectors.push(onSelect);
        return vi.fn();
      },
    );
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load Google map' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enable Google address search' })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enable Google address search' }));
    await waitFor(() => expect(selectors).toHaveLength(2));
    act(() =>
      selectors[0]!({
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
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load Google map' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Request Google public transport routes' }),
      ).toBeVisible(),
    );
    fireEvent.change(screen.getByLabelText('Return time', { exact: true }), {
      target: { value: '2026-10-10T17:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Google public transport routes' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No complete NZD fare'),
    );
    expect(google.getRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'transit', waypoints: [] }),
    );
    expect(screen.getByTestId('cost-transit')).toHaveTextContent('13.00');
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
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load Google map' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request Google driving routes' })).toBeVisible(),
    );
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Request Google driving routes' }));
    await waitFor(() => expect(google.getRoutes).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Destination', { exact: true }), {
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
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('5.45');
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
    render(<SmartCommutePlanner {...defaultProps} googleApiKey="restricted-test-key" />);
    fireEvent.click(
      screen.getByLabelText(/I understand Google Maps and route requests may incur charges/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load Google map' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request Google driving routes' })).toBeVisible(),
    );
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Request Google driving routes' }));
    await waitFor(() => expect(screen.getByTestId('route-card-google-oneway')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Include the return journey', { exact: true }));
    expect(screen.queryByTestId('route-card-google-oneway')).not.toBeInTheDocument();
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
  });
});
