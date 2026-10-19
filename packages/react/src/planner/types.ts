import {
  type CommuteSettings,
  type JourneyOption,
  type Location,
  type OwnershipCosts,
  type RouteResult,
} from '@smart-commute/core';
import {
  type RouteResult as ProviderRouteResult,
  type RouteErrorCode,
  type WeatherForecast,
} from '@smart-commute/providers';
import { type Locale, createTranslator } from '@smart-commute/i18n';

export interface SmartCommutePlannerProps {
  destination: Location | string;
  origin?: Location | string;
  locale?: Locale;
  fuelPrice?: number;
  fuelConsumption?: number;
  theme?: 'light' | 'dark';
  onRouteSelected?: (result: RouteResult) => void;
  /** Optional restricted browser key. Online planners load the map and address search on mount. */
  googleApiKey?: string;
  /** Demo or test weather; shown with a demo label and never fetched. */
  weatherFixture?: WeatherForecast;
}

export type Screen = 'planner' | 'comparison' | 'breakdown' | 'settings' | 'about';
/** Full-screen pages that open over the phone map; the map itself stays mounted underneath. */
export type MobilePage = 'route' | 'costs' | Exclude<Screen, 'planner'>;
export type Direction = 'outbound' | 'inbound';
export type Translator = ReturnType<typeof createTranslator>;
export interface PlannerState {
  origin: Location;
  destination: Location;
  settings: CommuteSettings;
  options: JourneyOption[];
  places: Location[];
  savedRoutes: JourneyOption[];
  /** Auckland wall-clock time, `YYYY-MM-DDTHH:mm`. */
  departure: string;
  /** Auckland wall-clock time of a chosen return departure. */
  returnTime: string;
  leaveNow: boolean;
  /** A round trip either estimates the return from the outbound route or routes a chosen time. */
  returnPolicy: 'estimate' | 'scheduled';
  /** Which of two instants a time repeated by a daylight-saving change means, once chosen. */
  departureFold?: 'earlier' | 'later';
  returnFold?: 'earlier' | 'later';
  /** Times saved in an unknown browser time zone; they are used only after confirmation. */
  timesNeedReview?: boolean;
  /** What a car costs to own, for the buy-a-car comparison. */
  ownership: OwnershipCosts;
  /** Whether public transport in that comparison stops at the AT HOP 7-day cap. */
  applyFareCap: boolean;
  /** What a new set of routes is sorted and chosen by: the lowest price or the shortest time. */
  priority?: RoutePriority;
  /**
   * True once the rider types a fuel price. Until then live planning follows MBIE's weekly
   * national average for the car's fuel; the offline example keeps its fixed values.
   */
  fuelPriceChosen?: boolean;
}
export type RoutePriority = 'cost' | 'time';
export type LiveMode = 'drive' | 'transit';
/** A route request's lifecycle, kept apart from the map's own loading state. */
export type RouteStatus =
  | { state: 'idle' }
  | { state: 'loading' | 'success' | 'no-routes'; key: string; mode: LiveMode }
  | { state: 'error'; key: string; mode: LiveMode; code?: RouteErrorCode };

/** What the route page changed, so leaving it without confirming restores the planned trip. */
export interface RouteDraft {
  fingerprint: string;
  origin: Location;
  destination: Location;
  leaveNow: boolean;
  departure: string;
  returnTime: string;
  returnPolicy: PlannerState['returnPolicy'];
  departureFold?: 'earlier' | 'later';
  returnFold?: 'earlier' | 'later';
  timesNeedReview?: boolean;
  roundTrip: boolean;
  options: JourneyOption[];
  googleResponse: ProviderRouteResult | null;
  selectedId: string;
  editingMode: JourneyOption['mode'];
}

export type StatusAction =
  | 'plan'
  | 'retry'
  | 'edit'
  | 'changeTime'
  | 'switchMode'
  | 'manual'
  | 'oneWay'
  | 'estimate'
  | 'removeStops'
  | 'drive'
  | 'costs';
