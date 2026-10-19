/**
 * Whether driving to a cheaper fuel station pays: the price gap on the litres bought, against
 * the fuel, wear and (optionally) time the extra drive there and back costs.
 */
export interface FuelDetourInput {
  /** Litres you would put in. */
  litres: number;
  /** Price per litre at the station you would otherwise use. */
  nearbyPrice: number;
  /** Price per litre at the cheaper station. */
  cheaperPrice: number;
  /** Extra kilometres to reach the cheaper station and come back, compared with not going. */
  extraKm: number;
  /** The car's fuel use, litres per 100 km. */
  consumptionPer100Km: number;
  /** Wear and road user charges per extra kilometre, NZ$. */
  runningCostPerKm?: number;
  /** Extra minutes the detour takes; counted only with a value of time. */
  extraMinutes?: number;
  /** What an hour of your time is worth, NZ$. */
  valueOfTimePerHour?: number;
}

export interface FuelDetourResult {
  /** What the price gap saves on the litres bought. */
  fuelSaving: number;
  /** Fuel the extra drive burns, which is bought at the cheaper price. */
  detourLitres: number;
  detourFuelCost: number;
  runningCost: number;
  timeCost: number;
  /** Saving minus every detour cost; negative means the detour costs money. */
  net: number;
  worthIt: boolean;
  /** Litres needed for the detour to break even; undefined when the price gap is not positive. */
  breakEvenLitres?: number;
  /** The longest extra drive the saving still covers, in km; 0 when the price gap is not positive. */
  maxExtraKm: number;
}

function checked(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be zero or more.`);
  return value;
}

export function fuelDetourValue(input: FuelDetourInput): FuelDetourResult {
  const litres = checked(input.litres, 'litres');
  const nearby = checked(input.nearbyPrice, 'nearbyPrice');
  const cheaper = checked(input.cheaperPrice, 'cheaperPrice');
  const extraKm = checked(input.extraKm, 'extraKm');
  const consumption = checked(input.consumptionPer100Km, 'consumptionPer100Km');
  const perKm = checked(input.runningCostPerKm ?? 0, 'runningCostPerKm');
  const minutes = checked(input.extraMinutes ?? 0, 'extraMinutes');
  const hourValue = checked(input.valueOfTimePerHour ?? 0, 'valueOfTimePerHour');

  const gap = nearby - cheaper;
  const fuelSaving = litres * gap;
  const detourLitres = (extraKm * consumption) / 100;
  const detourFuelCost = detourLitres * cheaper;
  const runningCost = extraKm * perKm;
  const timeCost = (minutes / 60) * hourValue;
  const detourCost = detourFuelCost + runningCost + timeCost;
  const net = fuelSaving - detourCost;
  // Time scales with distance on the same detour, so it joins the per-km cost for the limit.
  const costPerKm = (consumption / 100) * cheaper + perKm + (extraKm > 0 ? timeCost / extraKm : 0);
  return {
    fuelSaving,
    detourLitres,
    detourFuelCost,
    runningCost,
    timeCost,
    net,
    worthIt: net > 0,
    ...(gap > 0 ? { breakEvenLitres: detourCost / gap } : {}),
    maxExtraKm: gap > 0 && costPerKm > 0 ? fuelSaving / costPerKm : 0,
  };
}
