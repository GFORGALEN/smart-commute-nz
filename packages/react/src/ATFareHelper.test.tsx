import { fireEvent, render, screen } from '@testing-library/react';
import type { JourneyOption, TravelLeg } from '@smart-commute/core';
import { describe, expect, it, vi } from 'vitest';
import { ATFareHelper } from './ATFareHelper';

const weekdayDeparture = new Date('2026-10-08T07:30:00+13:00');
const weekdayReturn = new Date('2026-10-08T17:30:00+13:00');
const leg = (mode: TravelLeg['mode'], durationMinutes: number): TravelLeg => ({
  mode,
  durationMinutes,
  source: 'manual',
  estimated: true,
});

function journey(
  outbound: TravelLeg[] = [leg('walk', 8), leg('wait', 7), leg('bus', 35)],
  inbound: TravelLeg[] = [leg('train', 45), leg('walk', 10)],
): JourneyOption {
  return {
    id: 'test-transit',
    name: 'Test transit',
    mode: 'transit',
    outbound,
    inbound,
    parkingCost: 0,
    waypoints: [],
  };
}

function mount(option = journey(), roundTrip = true, locationContext?: string) {
  const onApply = vi.fn<(outboundFare: number, returnFare: number) => void>();
  const props = {
    option,
    locale: 'en' as const,
    onApply,
    roundTrip,
    locationContext,
    departureTime: weekdayDeparture,
    returnTime: weekdayReturn,
  };
  const result = render(<ATFareHelper {...props} />);
  fireEvent.click(screen.getByText('Estimate with AT fare rules', { exact: true }));
  return { ...result, onApply, props };
}

const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const check = (label: string) => fireEvent.click(screen.getByLabelText(label, { exact: true }));
const applyButton = () => screen.getByRole('button', { name: 'Apply AT fare estimate' });

function verifyZones(outbound = '2', inbound = '3', roundTrip = true) {
  change('Outbound verified zones', outbound);
  if (roundTrip) change('Return verified zones', inbound);
  check('I have verified these fare zones in the official AT Journey Planner.');
}

describe('ATFareHelper', () => {
  it('requires known zones in each direction and explicit official verification', () => {
    const { onApply } = mount();
    expect(screen.getByLabelText('Outbound verified zones', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('Return verified zones', { exact: true })).toHaveValue('');
    expect(applyButton()).toBeDisabled();

    change('Outbound verified zones', '2');
    check('I have verified these fare zones in the official AT Journey Planner.');
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();

    change('Return verified zones', '3');
    expect(
      screen.getByLabelText('I have verified these fare zones in the official AT Journey Planner.'),
    ).not.toBeChecked();
    expect(applyButton()).toBeDisabled();
    check('I have verified these fare zones in the official AT Journey Planner.');
    expect(applyButton()).toBeEnabled();
    check('I have verified these fare zones in the official AT Journey Planner.');
    expect(applyButton()).toBeDisabled();
  });

  it('applies independent outbound and return fares instead of doubling one direction', () => {
    const { onApply } = mount();
    verifyZones();
    const estimates = screen.getAllByRole('status');
    expect(estimates).toHaveLength(2);
    expect(estimates[0]).toHaveTextContent(/Outbound.*4\.90/);
    expect(estimates[1]).toHaveTextContent(/Return.*6\.50/);
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);
  });

  it('allows one-way fares without requiring return zones or a return time', () => {
    const { onApply, props, rerender } = mount(journey(), false);
    rerender(<ATFareHelper {...props} returnTime={undefined} />);
    verifyZones('2', '3', false);
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 0);
  });

  it('does not quote a return journey using the outbound date when its date is missing', () => {
    const { onApply, props, rerender } = mount();
    rerender(<ATFareHelper {...props} returnTime={undefined} />);
    verifyZones();
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('uses the published registered tertiary HOP concession for both directions', () => {
    const { onApply } = mount();
    verifyZones();
    change('Passenger type', 'tertiary');
    check('My eligible concession is registered on my AT HOP card.');
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(2.9, 3.9);
  });

  it('uses adult contactless fares even for a selected tertiary passenger', () => {
    const { onApply } = mount();
    verifyZones();
    change('Passenger type', 'tertiary');
    change('Payment method', 'contactless');
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);
  });

  it('requires a numeric transfer gap and same-payment confirmation in every applicable direction', () => {
    const { onApply } = mount(
      journey(
        [leg('bus', 20), leg('wait', 10), leg('train', 30)],
        [leg('train', 30), leg('wait', 5), leg('bus', 20)],
      ),
    );
    verifyZones();
    expect(applyButton()).toBeDisabled();
    change('Outbound maximum tag-off / tag-on gap (min)', '30');
    check(
      'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
    );
    expect(applyButton()).toBeDisabled();
    change('Return maximum tag-off / tag-on gap (min)', '0');
    expect(applyButton()).toBeDisabled();
    check(
      'Return: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
    );
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);
  });

  it('rejects a transfer count that is not represented by separate transit segments', () => {
    const { onApply } = mount(journey([{ ...leg('bus', 35), transfers: 1 }]));
    verifyZones();
    expect(
      screen.getByText(/^Some transfers are not represented by separate bus\/train segments\./),
    ).toBeVisible();
    expect(
      screen.queryByLabelText('Outbound maximum tag-off / tag-on gap (min)', { exact: true }),
    ).not.toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('requires an entered gap and attestation when declared transfers are represented by explicit rides', () => {
    const { onApply } = mount(journey([{ ...leg('bus', 20), transfers: 1 }, leg('train', 30)]));
    verifyZones();
    expect(
      screen.getByLabelText('Outbound maximum tag-off / tag-on gap (min)', { exact: true }),
    ).toHaveValue(null);
    check(
      'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
    );
    expect(applyButton()).toBeDisabled();
    change('Outbound maximum tag-off / tag-on gap (min)', '20');
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);
  });

  it('invalidates a transfer attestation when its count changes and rejects any unrepresented additional transfer', () => {
    const withTransfers = (transfers: number) =>
      journey([{ ...leg('bus', 20), transfers }, leg('train', 30)]);
    const { onApply, props, rerender } = mount(withTransfers(0));
    verifyZones();
    change('Outbound maximum tag-off / tag-on gap (min)', '20');
    const attestation =
      'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.';
    check(attestation);
    expect(applyButton()).toBeEnabled();

    rerender(<ATFareHelper {...props} option={withTransfers(1)} />);
    expect(screen.getByLabelText(attestation, { exact: true })).not.toBeChecked();
    expect(
      screen.getByLabelText(
        'I have verified these fare zones in the official AT Journey Planner.',
        { exact: true },
      ),
    ).not.toBeChecked();
    check('I have verified these fare zones in the official AT Journey Planner.');
    expect(
      screen.getByLabelText('Outbound maximum tag-off / tag-on gap (min)', { exact: true }),
    ).toHaveValue(20);
    expect(applyButton()).toBeDisabled();
    check(attestation);
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);

    rerender(<ATFareHelper {...props} option={withTransfers(2)} />);
    expect(
      screen.getByText(/^Some transfers are not represented by separate bus\/train segments\./),
    ).toBeVisible();
    check('I have verified these fare zones in the official AT Journey Planner.');
    check(attestation);
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('rejects a 31-minute transfer gap even when the transfer declaration is checked', () => {
    const { onApply } = mount(journey([leg('bus', 20), leg('wait', 31), leg('train', 30)]));
    verifyZones();
    change('Outbound maximum tag-off / tag-on gap (min)', '31');
    check(
      'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
    );
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();
    change('Outbound maximum tag-off / tag-on gap (min)', '30');
    expect(applyButton()).toBeEnabled();
  });

  it('counts walk and wait time when enforcing the whole-journey four-hour limit', () => {
    const { onApply, props, rerender } = mount(
      journey([leg('wait', 40), leg('bus', 80), leg('train', 80), leg('walk', 41)]),
    );
    verifyZones();
    change('Outbound maximum tag-off / tag-on gap (min)', '20');
    check(
      'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
    );
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();

    rerender(
      <ATFareHelper
        {...props}
        option={journey([leg('wait', 40), leg('bus', 80), leg('train', 80), leg('walk', 40)])}
      />,
    );
    expect(applyButton()).toBeDisabled();
    check(
      'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
    );
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);
  });

  it('does not assign an AT bus/train fare to a direction containing only other modes', () => {
    const { onApply } = mount(journey([leg('walk', 10), leg('drive', 20), leg('parking', 5)]));
    verifyZones();
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('requires a paying accompanying passenger before applying an under-five free fare', () => {
    const { onApply } = mount();
    verifyZones();
    change('Passenger type', 'under5');
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();
    check('A paying passenger will accompany this child.');
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(0, 0);
  });

  it('applies a declared Auckland holiday concession separately for each direction', () => {
    const { onApply } = mount();
    verifyZones();
    change('Passenger type', 'child');
    check('My eligible concession is registered on my AT HOP card.');
    check('Outbound is a public holiday in Auckland.');
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(0, 3.9);
  });

  it('evaluates the SuperGold time threshold separately for outbound and return in Auckland', () => {
    const { onApply, props, rerender } = mount(journey([leg('bus', 35)], [leg('train', 45)]));
    rerender(
      <ATFareHelper
        {...props}
        departureTime={new Date('2026-10-08T08:59:00+13:00')}
        returnTime={new Date('2026-10-08T09:00:00+13:00')}
      />,
    );
    verifyZones();
    change('Passenger type', 'supergold');
    check('My eligible concession is registered on my AT HOP card.');
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 0);
  });

  it('requires reapplication when an applied SuperGold fare changes at the tag-on time threshold', () => {
    const { onApply, props, rerender } = mount(journey([leg('bus', 35)]), false);
    rerender(<ATFareHelper {...props} departureTime={new Date('2026-10-08T08:59:00+13:00')} />);
    verifyZones('2', '3', false);
    change('Passenger type', 'supergold');
    check('My eligible concession is registered on my AT HOP card.');
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 0);
    expect(screen.getByText('AT fare estimate applied to this journey.')).toBeVisible();

    rerender(<ATFareHelper {...props} departureTime={new Date('2026-10-08T09:00:00+13:00')} />);
    const notice =
      'Your estimated tag-on time has changed. Check eligibility and apply a new fare estimate; the planner still holds the previously entered fare.';
    expect(screen.queryByText('AT fare estimate applied to this journey.')).not.toBeInTheDocument();
    expect(screen.getByText(notice)).toHaveAttribute('role', 'status');
    expect(screen.getByText(/^Outbound:.*0\.00$/)).toHaveAttribute('role', 'status');
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 0);
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply).toHaveBeenLastCalledWith(0, 0);
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    expect(screen.getByText('AT fare estimate applied to this journey.')).toBeVisible();
  });

  it('requires zone reverification when the commute location context changes', () => {
    const { onApply, props, rerender } = mount(journey(), true, 'origin-A / destination-A');
    verifyZones();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(4.9, 6.5);
    expect(screen.getByText('AT fare estimate applied to this journey.')).toBeVisible();

    rerender(<ATFareHelper {...props} locationContext="origin-B / destination-B" />);
    expect(
      screen.getByLabelText(
        'I have verified these fare zones in the official AT Journey Planner.',
        { exact: true },
      ),
    ).not.toBeChecked();
    expect(screen.queryByText('AT fare estimate applied to this journey.')).not.toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledTimes(1);
    check('I have verified these fare zones in the official AT Journey Planner.');
    expect(applyButton()).toBeEnabled();
  });

  it('uses the first transit tag-on after hybrid access travel for SuperGold eligibility independently of the return', () => {
    const option: JourneyOption = {
      ...journey(
        [leg('drive', 10), leg('parking', 3), leg('walk', 5), leg('wait', 2), leg('bus', 35)],
        [leg('train', 45)],
      ),
      mode: 'hybrid',
    };
    const { onApply, props, rerender } = mount(option);
    rerender(
      <ATFareHelper
        {...props}
        departureTime={new Date('2026-10-08T08:50:00+13:00')}
        returnTime={new Date('2026-10-09T08:50:00+13:00')}
      />,
    );
    verifyZones();
    change('Passenger type', 'supergold');
    check('My eligible concession is registered on my AT HOP card.');
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(0, 6.5);
  });

  it.each([Number.NaN, -1])(
    'rejects an invalid preceding driving duration of %s even with a valid transit ride',
    (durationMinutes) => {
      const option: JourneyOption = {
        ...journey([leg('drive', durationMinutes), leg('bus', 35)]),
        mode: 'hybrid',
      };
      const { onApply } = mount(option);
      verifyZones();
      expect(applyButton()).toBeDisabled();
      fireEvent.click(applyButton());
      expect(onApply).not.toHaveBeenCalled();
    },
  );

  it('uses the Auckland day at the first transit tag-on when access travel crosses into a weekend', () => {
    const option: JourneyOption = {
      ...journey([leg('drive', 20), leg('bus', 35)], [leg('train', 45)]),
      mode: 'hybrid',
    };
    const { onApply, props, rerender } = mount(option);
    rerender(
      <ATFareHelper
        {...props}
        departureTime={new Date('2026-10-09T23:50:00+13:00')}
        returnTime={new Date('2026-10-12T08:30:00+13:00')}
      />,
    );
    verifyZones();
    change('Passenger type', 'child');
    check('My eligible concession is registered on my AT HOP card.');
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(0, 3.9);
  });
});
