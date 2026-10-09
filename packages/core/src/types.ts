export type TravelMode = 'drive' | 'bus' | 'train' | 'walk' | 'wait' | 'parking';
export type JourneyMode = 'drive' | 'transit' | 'hybrid';
export type DataSource = 'manual' | 'google' | 'at-rule';

export interface Location {
  label: string;
  coordinates?: { lat: number; lng: number };
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
}

export interface LegTotals {
  fuelCost: number;
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
  'estimated-data' | 'fare-range-estimate' | 'unverified-parking' | 'missing-return';

export interface RouteResult {
  id: string;
  name: string;
  mode: JourneyMode;
  totalCost: number;
  totalCostRange?: CostRange;
  fuelCost: number;
  fareCost: number;
  fareCostRange?: CostRange;
  parkingCost: number;
  tollCost: number;
  maintenanceCost: number;
  totalMinutes: number;
  distanceKm: number;
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
}
