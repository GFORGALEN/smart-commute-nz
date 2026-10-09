import type { Locale } from './index';

const en = {
  title: 'Estimate with AT fare rules',
  description:
    'Optional static bus/train rules. Verify the combined fare zones for each direction yourself; distance does not determine zones.',
  snapshot: 'Verified {verified} · effective {effective} · source updated {updated}',
  source: 'Official AT fare table',
  zonesSource: 'AT Journey Planner',
  outbound: 'Outbound',
  inbound: 'Return',
  outboundZones: 'Outbound verified zones',
  inboundZones: 'Return verified zones',
  unknownZones: 'Choose verified zones',
  zoneCount: '{count} zone(s)',
  verifyZones: 'I have verified these fare zones in the official AT Journey Planner.',
  payment: 'Payment method',
  hop: 'AT HOP card',
  contactless: 'Contactless card / device',
  passenger: 'Passenger type',
  adult: 'Adult',
  under5: 'Child under 5',
  child: 'Child aged 5–15',
  secondary: 'Secondary school student',
  tertiary: 'Tertiary student',
  accessible: 'Accessible concession',
  community: 'Community Services Card concession',
  supergold: 'SuperGold card holder',
  registered: 'My eligible concession is registered on my AT HOP card.',
  accompanied: 'A paying passenger will accompany this child.',
  concessionNote:
    'Select your verified eligibility, not an assumed discount. Contactless uses adult fares for concessions that require registered HOP.',
  adultFallback:
    'A registered, eligible HOP concession is not confirmed. The applicable adult fare will be used.',
  supergoldNote:
    'SuperGold eligibility is evaluated in Auckland time: registered HOP, after 9am on weekdays, or weekends / public holidays.',
  holidayOutbound: 'Outbound is a public holiday in Auckland.',
  holidayInbound: 'Return is a public holiday in Auckland.',
  holidayNote: 'Public holiday status is supplied by you. It is not looked up automatically.',
  maxGapOutbound: 'Outbound maximum tag-off / tag-on gap (min)',
  maxGapInbound: 'Return maximum tag-off / tag-on gap (min)',
  confirmOutbound:
    'Outbound: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
  confirmInbound:
    'Return: I use the same card/device, every transfer is within 30 minutes, and the whole journey is within 4 hours.',
  transferNote:
    'Enter your actual longest gap between tagging off and tagging on again. This upper bound is checked for every transfer; no intervals are invented.',
  durationNote: '{boardings} bus/train boarding(s) · {minutes} min including walking and waiting',
  boardingTime:
    'Estimated {direction} first bus/train tag-on: {time} (Auckland time). Includes {minutes} minutes of entered access travel.',
  boardingNote:
    'Tag-on is estimated from your entered drive, parking, walk and wait times. Actual tag-on determines time-based eligibility; verify it before travelling.',
  inputNote:
    'The duration comes from your route inputs. Driving and parking are excluded from the bus/train fare journey.',
  chooseZones: 'Choose the verified combined fare-zone count for this direction.',
  verifyZonesRequired:
    'Confirm that you have checked the fare zones with AT before applying an estimate.',
  noRide: 'This direction needs at least one bus or train segment with a positive travel time.',
  invalidDuration:
    'Enter finite, non-negative segment times, with a positive time for every bus/train ride.',
  invalidAccessDuration:
    'Enter finite, non-negative times for every access segment before the first bus/train boarding.',
  invalidTransfers: 'Transfer counts must be finite, non-negative whole numbers.',
  embeddedTransfers:
    'Some transfers are not represented by separate bus/train segments. Add every ride as its own segment and remove unrepresented transfer counts before using an integrated AT fare.',
  reapplyAfterTimeChange:
    'Your estimated tag-on time has changed. Check eligibility and apply a new fare estimate; the planner still holds the previously entered fare.',
  tooLong:
    'The bus/train journey exceeds 4 hours including walking and waiting. Enter its separate fares manually.',
  transferConfirmation:
    'Confirm the same-card and transfer-window conditions before combining these boardings into one fare.',
  gapRequired: 'Enter the actual maximum tag-off / tag-on transfer gap.',
  gapInvalid: 'The transfer gap must be a finite number of zero or more.',
  gapTooLong: 'A transfer gap exceeds 30 minutes. Enter the separate journey fares manually.',
  accompanyRequired: 'Under-5 free travel needs a paying accompanying passenger.',
  returnTimeRequired: 'Set a return time to estimate its fare independently.',
  invalidDate: 'Choose a valid travel date and time.',
  unavailable:
    'The published snapshot cannot price this journey. Check the date and eligibility, or enter a verified manual fare.',
  estimate: '{direction}: {amount}',
  roundTripEstimate: 'Combined estimated fares: {amount}',
  staticOnly: 'Static AT estimate — not a live fare quote. Check current rules before travelling.',
  apply: 'Apply AT fare estimate',
  applied: 'AT fare estimate applied to this journey.',
  replaceNotice:
    'Applying places one whole-journey fare on the first bus/train segment and zero on later bus/train segments in each direction. Your driving, toll and parking costs stay as entered.',
  capsNote:
    'Weekly/monthly projections repeat this entered fare. HOP 7-day and contactless daily caps are not tracked in these projections.',
  errorHeading: 'A fare estimate is not available yet.',
  freeFare: 'Free-travel estimate depends on the eligibility and date you supplied.',
} as const;

const zh: Record<keyof typeof en, string> = {
  title: '使用 AT 票价规则估算',
  description:
    '可选的公交 / 火车静态规则。请自行核实每个方向经过的合并票价分区，不能根据距离推算分区。',
  snapshot: '核实日期 {verified} · 生效日期 {effective} · 来源更新 {updated}',
  source: 'AT 官方票价表',
  zonesSource: 'AT 行程规划器',
  outbound: '去程',
  inbound: '回程',
  outboundZones: '已核实的去程分区数',
  inboundZones: '已核实的回程分区数',
  unknownZones: '请选择已核实的分区数',
  zoneCount: '{count} 个分区',
  verifyZones: '我已在 AT 官方行程规划器核实这些票价分区。',
  payment: '付款方式',
  hop: 'AT HOP 卡',
  contactless: '非接触式银行卡 / 设备',
  passenger: '乘客类型',
  adult: '成人',
  under5: '5 岁以下儿童',
  child: '5–15 岁儿童',
  secondary: '中学生',
  tertiary: '高等教育学生',
  accessible: '无障碍优惠资格',
  community: 'Community Services Card 优惠资格',
  supergold: 'SuperGold 持卡人',
  registered: '我已在 AT HOP 卡上登记有效的优惠资格。',
  accompanied: '这名儿童将由一位付费乘客陪同。',
  concessionNote:
    '请按已核实的资格选择，不要假定折扣。需要 HOP 登记的优惠使用非接触式付款时按成人票价计费。',
  adultFallback: '尚未确认已登记的有效 HOP 优惠资格，将使用适用的成人票价。',
  supergoldNote:
    'SuperGold 按奥克兰时间判定：已登记的 HOP 卡，工作日上午 9 点以后，或周末 / 公共假日。',
  holidayOutbound: '去程日期是奥克兰的公共假日。',
  holidayInbound: '回程日期是奥克兰的公共假日。',
  holidayNote: '公共假日状态由你填写，系统不会自动查询。',
  maxGapOutbound: '去程刷卡离站 / 再上车的最长间隔 (分钟)',
  maxGapInbound: '回程刷卡离站 / 再上车的最长间隔 (分钟)',
  confirmOutbound:
    '去程：我使用同一张卡或设备，每次换乘间隔不超过 30 分钟，整段行程不超过 4 小时。',
  confirmInbound: '回程：我使用同一张卡或设备，每次换乘间隔不超过 30 分钟，整段行程不超过 4 小时。',
  transferNote:
    '请输入实际最长的刷卡离站至再次上车间隔。这个上限将用于检查每次换乘，系统不会编造间隔。',
  durationNote: '{boardings} 次公交 / 火车乘车 · 含步行与候车共 {minutes} 分钟',
  boardingTime:
    '估算{direction}首次公交 / 火车刷卡上车时间：{time}（奥克兰时间），包含填写的 {minutes} 分钟接驳行程。',
  boardingNote:
    '刷卡上车时间根据你填写的驾车、停车、步行与候车时间估算。是否满足时段优惠取决于实际刷卡时间，请在出行前核实。',
  inputNote: '时间来自你的路线输入。驾车与停车不计入公交 / 火车的票价行程。',
  chooseZones: '请选择此方向已核实的合并票价分区数。',
  verifyZonesRequired: '应用估算前，请确认已向 AT 核实票价分区。',
  noRide: '此方向至少需要一个行程时间大于零的公交或火车路段。',
  invalidDuration: '各路段时间须为非负有限数值，每个公交 / 火车路段的时间须大于零。',
  invalidAccessDuration: '首次公交 / 火车乘车前，每个接驳路段时间须为非负有限数值。',
  invalidTransfers: '换乘次数须为非负有限整数。',
  embeddedTransfers:
    '部分换乘尚未用独立的公交 / 火车路段表示。使用 AT 合并票价前，请为每次乘车添加独立路段，并移除未表示的额外换乘次数。',
  reapplyAfterTimeChange:
    '估算刷卡上车时间已改变，请重新核实资格并应用新的票价估算。规划器目前仍保留之前填写的票价。',
  tooLong: '公交 / 火车行程含步行与候车已超过 4 小时，请手动填写分段票价。',
  transferConfirmation: '合并这些乘车段为一笔票价前，请确认同卡付款与换乘时限条件。',
  gapRequired: '请输入实际最长的离站 / 再上车刷卡间隔。',
  gapInvalid: '换乘间隔须为大于或等于零的有限数值。',
  gapTooLong: '换乘间隔超过 30 分钟，请手动填写各段独立行程的票价。',
  accompanyRequired: '5 岁以下儿童免费乘车需要一位付费乘客陪同。',
  returnTimeRequired: '请设置回程时间，以独立估算回程票价。',
  invalidDate: '请选择有效的出行日期与时间。',
  unavailable: '当前发布的票价快照无法为此行程报价。请检查日期与资格，或手动输入核实后的票价。',
  estimate: '{direction}：{amount}',
  roundTripEstimate: '合计估算票价：{amount}',
  staticOnly: 'AT 静态规则估算，不是实时报价。出行前请检查最新规则。',
  apply: '应用 AT 估算票价',
  applied: '已将 AT 估算票价应用到此行程。',
  replaceNotice:
    '每个方向的整段行程票价将填写到第一个公交 / 火车路段，后续公交 / 火车路段票价置零。驾车、通行费与停车费仍使用原先输入。',
  capsNote:
    '每周 / 每月预算按当前输入票价重复计算，不跟踪 HOP 的 7 天封顶或非接触式付款的每日封顶。',
  errorHeading: '目前还无法提供票价估算。',
  freeFare: '免费乘车估算取决于你填写的资格与出行日期。',
};

export type FareHelperMessageKey = keyof typeof en;

export function createFareHelperTranslator(locale: Locale = 'en') {
  return (key: FareHelperMessageKey, params: Record<string, string | number> = {}): string => {
    let value: string = (locale === 'zh-CN' ? zh : en)[key];
    for (const [name, parameter] of Object.entries(params))
      value = value.replaceAll(`{${name}}`, String(parameter));
    return value;
  };
}
