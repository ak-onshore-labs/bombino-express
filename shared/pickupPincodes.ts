/**
 * Pickup serviceability, and the same-day cutoff, by origin pincode.
 *
 * Doorstep pickup runs out of a handful of hubs and only covers the pincodes
 * below. Anywhere else the customer has to bring the parcel to us, so the
 * booking form forces `pickup_request = 2` and POST /api/orders rejects a
 * pickup that slipped past it.
 *
 * Two shapes of coverage, because that is how ops gave it:
 *   - Named pincodes (Kolkata, Delhi, Mumbai's Fort hub) — an explicit list,
 *     with the locality name so we can say it back to the customer.
 *   - Whole-city hubs (Surat, Pune, Chennai, Hyderabad) — "all of <city>",
 *     matched on a numeric range. No locality names to give.
 *
 * Each hub also carries its own cutoff: riders out of Fort work until 7 PM,
 * Delhi and the western hubs until 5, Hyderabad until 3. Booking past a hub's
 * cutoff pushes collection to the next day, so the date picker has to ask the
 * pincode, not a global constant.
 *
 * Within Kolkata the sheet marks some pincodes "OUT OF CITY (CHARGE WILL BE
 * EXTRA)": the agent still comes, but the run is outside the hub's normal beat
 * and costs more. We surface that as a warning before the customer commits,
 * not as a block. The amount is not fixed here — it is settled when the parcel
 * is weighed — so the notice names the charge without a number.
 *
 * Rider names and phone numbers are deliberately absent. Which rider takes a
 * job is ops' routing decision, made after the booking exists; the customer
 * gets their contact from the assigned-agent flow, not from this table.
 *
 * Source: ops' serviceable-pincode sheet (Delhi + Kolkata) and the hub roster,
 * Aug 2026. Static on purpose: it changes a few times a year, and a lookup
 * that can time out has no business standing between a customer and a booking.
 */

import { PICKUP_CUTOFF_HOUR } from './istTime.js';

export type PickupRemark = 'ok' | 'out_of_city';

export interface PickupArea {
  /** Hub city serving this pincode. */
  city: string;
  /** Locality as ops record it, or the city itself where they cover all of it. */
  area: string;
  remark: PickupRemark;
  /** Latest IST hour a booking here is still collected the same day. */
  cutoffHour: number;
}

export type PickupServiceability =
  | ({ serviceable: true } & PickupArea)
  | { serviceable: false };

/** [pincode, area, 1 if out-of-city surcharge applies] */
type Row = readonly [string, string, 0 | 1];

const KOLKATA: readonly Row[] = [
  ['700001', 'DALHOUSIE', 0],
  ['700002', 'COSSIPORE', 1],
  ['700003', 'BAG BAZAR', 1],
  ['700004', 'SHYAMBAZAR', 0],
  ['700005', 'HATKOLA', 1],
  ['700006', 'BEADON STREET', 0],
  ['700007', 'BARABAZAR', 0],
  ['700008', 'BARISHA', 1],
  ['700009', 'RAJA RAMMOHAN ROY SARANI', 0],
  ['700010', 'BELIAGHATA', 0],
  ['700011', 'NARKELDANGA', 0],
  ['700012', 'BOWBAZAR', 0],
  ['700013', 'DHARMATALA', 0],
  ['700014', 'ENTALLY', 0],
  ['700015', 'TANGRA', 0],
  ['700016', 'PARK STREET', 0],
  ['700017', 'CIRCUS AVENUE', 0],
  ['700018', 'BURTOLA', 1],
  ['700019', 'BALLYGUNGE', 0],
  ['700020', 'ENGIN ROAD, MINTOO PARK', 0],
  ['700021', 'FORT WILLIAM', 0],
  ['700022', 'HASTINGS', 0],
  ['700023', 'KHIDIRPUR', 0],
  ['700024', 'GARDEN REACH', 1],
  ['700025', 'BHOWINIPORE', 0],
  ['700026', 'KALIGHAT', 0],
  ['700027', 'ALIPORE', 0],
  ['700028', 'DAMDAM', 1],
  ['700029', 'SARAT BOSE ROAD', 0],
  ['700030', 'GHUGHUDANGA', 1],
  ['700031', 'DHAKURIA', 0],
  ['700032', 'JADAVPUR UNIVERSITY', 0],
  ['700033', 'TOLLYGUNGE', 0],
  ['700034', 'BEHALA', 1],
  ['700035', 'ALAMBAZAR', 1],
  ['700036', 'BARANAGAR', 1],
  ['700037', 'BELGACHIA', 0],
  ['700038', 'SAHAPUR', 0],
  ['700039', 'TILJALA', 0],
  ['700040', 'REGENT PARK', 0],
  ['700041', 'PASCHIM PUTIARY', 1],
  ['700042', 'KASBA', 0],
  ['700043', 'S E RLY', 0],
  ['700044', 'BADARTALA', 1],
  ['700045', 'LAKE GARDENS', 0],
  ['700046', 'TOPSIA', 0],
  ['700047', 'NAKTALA', 1],
  ['700048', 'SREE BHUMI', 1],
  ['700049', 'NIMTA', 1],
  ['700050', 'SINTHEE', 0],
  ['700051', 'BIRATI', 1],
  ['700052', 'CAL. AIRPORT', 1],
  ['700053', 'NEW ALIPORE', 0],
  ['700054', 'KANKURGACHI', 0],
  ['700055', 'BANGUR AVENUE', 0],
  ['700056', 'BELGARIA', 0],
  ['700057', 'ARIADAHA', 1],
  ['700058', 'KAMARHATI', 1],
  ['700059', 'DESBANDHU NAGAR', 1],
  ['700060', 'PARNASREE PALLY', 1],
  ['700061', 'SARSUNA', 1],
  ['700063', 'THAKURPUR', 0],
  ['700064', 'SALT LAKE', 0],
  ['700065', 'RABINDRANAGAR', 1],
  ['700066', 'BIDHANGAR', 0],
  ['700067', 'ULTADANGA', 0],
  ['700068', 'JODHPUR PARK', 0],
  ['700069', 'ESPLANADE', 0],
  ['700070', 'BANSDRONI', 1],
  ['700071', 'CHOWRINGHEE', 0],
  ['700072', 'PRINCEP STREET', 0],
  ['700073', 'CHITTARANJAN AVENUE', 0],
  ['700074', 'MOTIJHEEL', 0],
  ['700075', 'SANTOSHPUR', 0],
  ['700076', 'DAKSHINESWAR', 1],
  ['700077', 'BEDIAPARA', 1],
  ['700078', 'HALTU', 1],
  ['700079', 'ITALGACHHA', 1],
  ['700080', 'MALL ROAD', 1],
  ['700081', 'RAJBARI COLONY', 1],
  ['700082', 'HARIDEBPUR', 1],
  ['700083', 'NANDAN NAGAR', 1],
  ['700084', 'GARIA', 1],
  ['700085', 'PAIKPARA', 1],
  ['700086', 'BAGHAJATIN', 0],
  ['700087', 'NEW MARKET', 0],
  ['700088', 'BRACE BRIDGE', 0],
  ['700089', 'LAKE TOWN', 0],
  ['700090', 'NAWPARA', 1],
  ['700091', 'SECH BHAWAN', 1],
  ['700092', 'REGENT ESTATE', 1],
  ['700093', 'PURBA PUNTIARY', 1],
  ['700094', 'PANCHASAYAR', 1],
  ['700095', 'GOLG GREEN', 0],
  ['700099', 'HIGHLAND PARK', 1],
  ['700100', 'VIP NAGAR', 1],
  ['700101', 'KESTOPUR', 0],
  ['700102', 'BY PASS', 0],
  ['700104', 'JOKA', 1],
  ['700105', 'SCIENCE CITY', 0],
  ['700108', 'BON HOOGLY', 1],
];

const DELHI: readonly Row[] = [
  ['110079', 'PATEL NAGAR', 0],
  ['110047', 'AYA NAGAR', 0],
  ['110001', 'CENTRAL DELHI', 0],
  ['110030', 'LADO SARAI', 0],
  ['110070', 'VASANT KUNJ', 0],
  ['110072', 'JHARODA KALAN', 0],
  ['110051', 'KRISHNA NAGAR', 0],
  ['110075', 'DWARKA SECTOR 6', 0],
  ['110068', 'NEB SARAI', 0],
  ['110012', 'INDER PURI', 0],
  ['110028', 'NARAINA', 0],
  ['110021', 'CHANAKYA PURI', 0],
  ['110011', 'SOUTH AVENUE', 0],
  ['110016', 'HAUSKHAS, GREEN PARK', 0],
  ['110049', 'GAUTAM NAGAR, GULMOHAR PARK', 0],
  ['110024', 'DEFENCE COLONY, LAJPAT NAGAR', 0],
  ['110094', 'GOKAL PURI, DAYAL PUR', 0],
  ['110046', 'SAGAR PUR', 0],
  ['110058', 'JANAK PURI', 0],
  ['110061', 'BIJWASAN', 0],
  ['110050', 'SAFDARJUNG', 0],
  ['110019', 'ALAKNANDA, CR PARK', 0],
  ['110048', 'GREATER KAILASH', 0],
  ['110065', 'EAST OF KAILASH, NEHRU NAGAR', 0],
  ['110020', 'OKHLA PHASE 1', 0],
  ['110080', 'SANGAM VIHAR', 0],
  ['110017', 'SAKET, PUSHP VIHAR', 0],
  ['110043', 'NAJAFGARH', 0],
  ['110071', 'CHHAWALA', 0],
  ['110085', 'ROHINI', 0],
  ['110089', 'SECTOR 15 ROHINI', 0],
  ['110027', 'RAJOURI GARDEN', 0],
  ['110003', 'LODHI ROAD, PRAGATI MAIDAN', 0],
  ['110033', 'JAHANGIR PURI, BHALASWA', 0],
  ['110044', 'BADAR PUR', 0],
  ['110039', 'AUCHANDI', 0],
  ['110036', 'ALI PUR', 0],
  ['110093', 'NAND NAGRI', 0],
  ['110095', 'VIVEK VIHAR, DILSHAD GARDEN', 0],
  ['110009', 'MODEL TOWN, VIJAY NAGAR', 0],
  ['110054', 'CIVIL LINES', 0],
  ['110007', 'RANA PRATAP BAGH', 0],
  ['110053', 'GHONDA, BHAJANPURA', 0],
  ['110023', 'KIDWAI NAGAR, LAXMIBAI NAGAR', 0],
  ['110022', 'R K PURAM', 0],
  ['110037', 'MAHIPALPUR', 0],
  ['110038', 'RAJOKRI', 0],
  ['110078', 'KAKROLA', 0],
  ['110013', 'HAZRAT NIZAMUDDIN', 0],
  ['110014', 'EEWAN NAGAR, JUNG PURA', 0],
  ['110074', 'CHANDAN HOLA', 0],
  ['110025', 'JAMIA, NEW FRIENDS COLONY', 0],
  ['110057', 'VASANT VIHAR', 0],
  ['110062', 'TUGLKABAD, DAKSHINPURI', 0],
  ['110066', 'R K PURAM', 0],
  ['110067', 'JNU, MUNIRKA', 0],
  ['110076', 'MADANPUR KHADAR, SARITA VIHAR', 0],
  ['110035', 'INDER LOK, KESHAV PURAM', 0],
  ['110052', 'ASHOK VIHAR', 0],
  ['110084', 'BURARI, JAGAT PUR', 0],
  ['110045', 'PALAM, INDRA PARK', 0],
  ['110026', 'PUNJABI BAGH', 0],
  ['110063', 'JWALA HERI, MADI PUR', 0],
  ['110056', 'SHAKUR BASTI', 0],
  ['110082', 'KHERA KALAN', 0],
  ['110073', 'DHANSA, MALIK PUR', 0],
  ['110008', 'PATEL NAGAR', 0],
  ['110096', 'KONDLI, NEW ASHOK NAGAR', 0],
  ['110083', 'MANGOL PURI', 0],
  ['110064', 'MAYA PURI, HARI NAGAR', 0],
  ['110042', 'BADLI, PEHLAD PUR', 0],
  ['110029', 'NOUROJI NAGAR, ANSARI NAGAR', 0],
  ['110060', 'RAJENDER NAGAR', 0],
  ['110040', 'NARELA', 0],
  ['110077', 'BAGROLA, BHARTHAL', 0],
  ['110088', 'SHALIMAR BAGH, HAIDER PUR', 0],
  ['110041', 'MUNDKA NANGLOI', 0],
  ['110087', 'SUNDER VIHAR', 0],
  ['110031', 'GANDHI NAGAR, GEETA COLONY', 0],
  ['110092', 'LAXMI NAGAR, ANAND VIHAR, MANDAWALI', 0],
  ['110090', 'SONIA VIHAR', 0],
  ['110032', 'BABAR PUR, VISHWAS NAGAR', 0],
  ['110091', 'KALYAN PURI, HILLA VILLAGE', 0],
  ['110015', 'BAKKAR WALA, CHAUKHANDI', 0],
  ['110018', 'ASHOK NAGAR, FATEH NAGAR', 0],
  ['110006', 'CHAWRI BAZAR, CHANDNI CHOWK', 0],
  ['110005', 'KAROL BAGH', 0],
  ['110002', 'AJMERI GATE, DARYAGANJ', 0],
  ['110034', 'MAURYA ENCLAVE, RANI BAGH', 0],
  ['110010', 'DELHI CANTT', 0],
  ['110055', 'PAHAR GANJ', 0],
  ['110069', 'CENTRAL DELHI', 0],
  ['110004', 'RASHTRAPATI BHAWAN', 0],
  ['110081', 'CHAND PUR, JAUNTI', 0],
  ['110059', 'MOHAN GARDEN', 0],
  ['110086', 'BEGAM PUR, BUDH VIHAR', 0],
  ['110097', 'KAPASHERA', 0],
];

/**
 * Mumbai — Fort hub. Ops list it per rider (three overlapping beats); this is
 * their union, which is what the customer actually needs to know. No locality
 * names came with it, so the whole hub answers to "Fort".
 */
const FORT: readonly Row[] = [
  ['400001', 'Fort', 0],
  ['400002', 'Fort', 0],
  ['400003', 'Fort', 0],
  ['400004', 'Fort', 0],
  ['400005', 'Fort', 0],
  ['400006', 'Fort', 0],
  ['400007', 'Fort', 0],
  ['400008', 'Fort', 0],
  ['400009', 'Fort', 0],
  ['400010', 'Fort', 0],
  ['400020', 'Fort', 0],
  ['400021', 'Fort', 0],
  ['400023', 'Fort', 0],
  ['400026', 'Fort', 0],
  ['400034', 'Fort', 0],
  ['400036', 'Fort', 0],
  ['400038', 'Fort', 0],
  ['400039', 'Fort', 0],
];

/**
 * Hubs that cover a whole city, given to us as a range rather than a list.
 * `from`/`to` are inclusive and compared numerically.
 */
interface RangeHub {
  city: string;
  from: number;
  to: number;
  cutoffHour: number;
}

const RANGE_HUBS: readonly RangeHub[] = [
  // "All Surat" / "All Pune" / "All Chennai" — the city's own postal block.
  { city: 'Surat', from: 395001, to: 395999, cutoffHour: 17 },
  { city: 'Pune', from: 411001, to: 411999, cutoffHour: 17 },
  { city: 'Chennai', from: 600001, to: 600999, cutoffHour: 17 },
  // Hyderabad came as an explicit range, not the whole 500 block.
  { city: 'Hyderabad', from: 500001, to: 500089, cutoffHour: 15 },
];

function index(
  target: Map<string, PickupArea>,
  rows: readonly Row[],
  city: string,
  cutoffHour: number
): void {
  for (const [pincode, area, surcharge] of rows) {
    target.set(pincode, {
      city,
      area,
      remark: surcharge === 1 ? 'out_of_city' : 'ok',
      cutoffHour,
    });
  }
}

const PICKUP_AREAS: ReadonlyMap<string, PickupArea> = (() => {
  const map = new Map<string, PickupArea>();
  // Kolkata's cutoff never came through with the roster, so it keeps the
  // conservative default until ops confirm it.
  index(map, KOLKATA, 'Kolkata', PICKUP_CUTOFF_HOUR);
  index(map, DELHI, 'Delhi', 17);
  index(map, FORT, 'Mumbai', 19);
  return map;
})();

const SIX_DIGITS = /^[0-9]{6}$/;

function matchRangeHub(code: string): PickupArea | null {
  const n = Number(code);
  for (const hub of RANGE_HUBS) {
    if (n >= hub.from && n <= hub.to) {
      return { city: hub.city, area: hub.city, remark: 'ok', cutoffHour: hub.cutoffHour };
    }
  }
  return null;
}

function findArea(pincode: string | null | undefined): PickupArea | null {
  const code = (pincode ?? '').trim();
  if (!SIX_DIGITS.test(code)) return null;
  return PICKUP_AREAS.get(code) ?? matchRangeHub(code);
}

const NOT_SERVICEABLE: PickupServiceability = { serviceable: false };

/** Where we collect from, in the customer's words. Copy only. */
export const PICKUP_CITIES = [
  'Delhi',
  'Mumbai (Fort)',
  'Kolkata',
  'Pune',
  'Surat',
  'Chennai',
  'Hyderabad',
] as const;

/** "a, b and c" — for a sentence, not a list. */
export function formatPickupCities(): string {
  const cities = [...PICKUP_CITIES] as string[];
  const last = cities.pop();
  return `${cities.join(', ')} and ${last}`;
}

/** An IST hour as the clock reads it: 17 -> "5 PM". */
export function formatCutoffHour(hour: number): string {
  return `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/**
 * Whether a doorstep pickup can be booked from `pincode`. A partially typed or
 * malformed pincode reads as not serviceable, so callers should only act on
 * this once six digits are in.
 */
export function getPickupServiceability(pincode: string | null | undefined): PickupServiceability {
  const area = findArea(pincode);
  return area ? { serviceable: true, ...area } : NOT_SERVICEABLE;
}

/** True once `pincode` is a complete six-digit code we do not pick up from. */
export function isPickupBlocked(pincode: string | null | undefined): boolean {
  const code = (pincode ?? '').trim();
  return SIX_DIGITS.test(code) && findArea(code) === null;
}

/**
 * The hub cutoff that applies to `pincode`, falling back to the conservative
 * default where we have no hub — so a caller asking about an uncovered pincode
 * gets a real hour rather than a promise we cannot keep.
 */
export function pickupCutoffHour(pincode: string | null | undefined): number {
  return findArea(pincode)?.cutoffHour ?? PICKUP_CUTOFF_HOUR;
}
