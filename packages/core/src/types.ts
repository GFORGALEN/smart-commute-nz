export type TravelMode = 'drive' | 'bus' | 'train' | 'walk' | 'wait' | 'parking';
export type JourneyMode = 'drive' | 'transit' | 'hybrid';
export type DataSource = 'manual' | 'google' | 'at-rule';

export interface Location {
  label: string;
  coordinates?: { lat: number; lng: number };
  /** Google place id when chosen from address search; session-only, never persisted. */
  placeId?: string;
}

export interface CostRange {
  min: number;
  max: number;
}

/** An approximate AT fare, rather than a quote or a verified zone count. */
export interface TransitFareRange extends CostRange {
  source: 'at-estimate';
  basis?: 'standard-adult' | 'citylink';
  assumptions?: string[];
}

export interface TransitDetails {
  stopCount?: number;
  departureStop?: string;
  arrivalStop?: string;
  lineName?: string;
  lineShortName?: string;
  agencyNames?: string[];
}

export interface TravelLeg {
  mode: TravelMode;
  distanceKm?: number;
  durationMinutes: number;
  /** Overrides the default vehicle consumption, in litres per 100 km. */
  fuelConsumption?: number;
  /** The fare paid for this leg. Integrated fares must be assigned only once. */
  fare?: number;
  /** Fare provenance can differ from the provider of the route geometry. */
  fareSource?: DataSource | 'at-estimate';
  /** Used only when no explicit fare is supplied; integrated ranges are assigned once. */
  fareRange?: TransitFareRange;
  transit?: TransitDetails;
  toll?: number;
  /** Additional changes of vehicle on this leg, supplied by the route provider. */
  transfers?: number;
  /** Traffic delay against free-flow time, in minutes, from a traffic-aware route provider. */
  congestionMinutes?: number;
  /** No fare is known yet. The leg adds nothing, and the option cannot be ranked until confirmed. */
  farePending?: boolean;
  source: DataSource;
  estimated: boolean;
}

export interface JourneyOption {
  id: string;
  name: string;
  mode: JourneyMode;
  outbound: TravelLeg[];
  inbound: TravelLeg[];
  /** Total parking charge for the selected commute; charged once, including a return. */
  parkingCost: number;
  parkingVerified?: boolean;
  waypoints: Location[];
  /**
   * Where the return legs came from: a route requested for the return time, or a budget
   * reference built from the outbound route. Missing means entered or routed directly.
   */
  returnBasis?: 'routed' | 'estimated-from-outbound';
}

export interface CommuteSettings {
  fuelPrice: number;
  fuelConsumption: number;
  /** User-defined decision weight in NZD per hour; this is not a cash expense. */
  valueOfTime: number;
  daysPerWeek: number;
  weeksPerMonth: number;
  roundTrip: boolean;
  /** Optional vehicle running allowance, applied only to driving distance. */
  maintenancePerKm: number;
  /** Extra fuel burnt per hour of traffic delay, in litres. Missing means no congestion cost. */
  congestionFuelPerHour?: number;
}

export interface LegTotals {
  fuelCost: number;
  /** Extra fuel for traffic delay, separate from distance-based fuel. */
  congestionFuelCost: number;
  congestionMinutes: number;
  fareCost: number;
  fareCostRange?: CostRange;
  tollCost: number;
  maintenanceCost: number;
  totalMinutes: number;
  distanceKm: number;
  transfers: number;
  /** Direction subtotal; the commute-level parking charge is separate. */
  totalCost: number;
  totalCostRange?: CostRange;
}

export type WarningCode =
  | 'estimated-data'
  | 'fare-range-estimate'
  | 'unverified-parking'
  | 'missing-return'
  | 'fare-pending';

export interface RouteResult {
  id: string;
  name: string;
  mode: JourneyMode;
  totalCost: number;
  totalCostRange?: CostRange;
  fuelCost: number;
  congestionFuelCost: number;
  congestionMinutes: number;
  fareCost: number;
  fareCostRange?: CostRange;
  parkingCost: number;
  tollCost: number;
  maintenanceCost: number;
  totalMinutes: number;
  distanceKm: number;
  /** False when a moving leg has no distance, so distanceKm is only a lower bound. */
  distanceComplete: boolean;
  transfers: number;
  dailyCost: number;
  dailyCostRange?: CostRange;
  weeklyCost: number;
  weeklyCostRange?: CostRange;
  monthlyCost: number;
  monthlyCostRange?: CostRange;
  generalizedCost: number;
  warnings: WarningCode[];
  option: JourneyOption;
  breakdown: { outbound: LegTotals; inbound: LegTotals };
}

export interface RouteComparison {
  /** Ordered by monetary cost (range upper bound), then duration, transfers and identifier. */
  results: RouteResult[];
  cheapest: RouteResult;
  fastest: RouteResult;
  fewestTransfers: RouteResult;
  bestValue: RouteResult;
  /** Shortest distance; routes with a missing leg distance rank after every complete one. */
  shortest: RouteResult;
}
