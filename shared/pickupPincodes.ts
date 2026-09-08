/**
 * Pickup serviceability, and the same-day cutoff, by origin pincode.
 *
 * Doorstep pickup runs out of a handful of hubs and only covers the pincodes
 * below. Anywhere else the customer has to bring the parcel to us, so the
 * booking form forces `pickup_request = 2` and POST /api/orders rejects a
 * pickup that slipped past it.
 *
 * ── What ops hand over ──────────────────────────────────────────────────────
 *
 * Always the same four lines, per rider:
 *
 *     Pickup Boy Name :
 *     Pickup Boy Contact Number:
 *     Pickup Serviceable Pincodes
 *     Pickup Cut-off Time
 *
 * That block is the contract; the spreadsheet stapled to it is not. Every
 * hand-over has arrived with a different sheet — Kolkata's carries a handling
 * branch and free-text remarks, Delhi's a region, Andheri's a route, Jaipur's
 * two bare columns. So the shape modelled here is the block, not the sheet: a
 * beat is a named set of pincodes with a cutoff and the riders who run it.
 *
 * ── Where the truth lives ───────────────────────────────────────────────────
 *
 * The database is authority — `pickup_beats` and the two tables under it, which
 * ops edit from the console without a deploy. This file is the floor beneath
 * that: it seeded those tables, and it is what the server answers from when the
 * database cannot be reached. Coverage changes a few times a year, and a lookup
 * that can time out has no business standing between a customer and a booking.
 *
 * Both paths resolve through `buildCoverage`, so they cannot disagree about how
 * to read the same rows — only about which rows they hold, and then only until
 * the next seed.
 *
 * ── Where these rows came from ──────────────────────────────────────────────
 *
 * Twenty beats across nine hubs, from two kinds of source, which is worth
 * knowing before trusting any one line.
 *
 * Ops gave us the pincodes for five, and those are the beats riders run:
 *   - Kolkata and Delhi, as lists with the locality name against each pincode,
 *     so we can say the area back to the customer.
 *   - Mumbai's Fort office, per rider: three rounds and a floater, whose splits
 *     came through on 8 Sep and reconstruct the union we had been holding.
 *   - Hyderabad, given as one contiguous span, 500001-500089. Ops drew that
 *     boundary themselves; it is not the whole 500 block, and we do not widen
 *     it to one.
 *   - Andheri, the suburban Mumbai hub, and the first ever given beat by beat:
 *     ten riders over nine rounds, each with its own locality-level list.
 *   - Jaipur, as a sheet of post offices resolving to 69 pincodes.
 *
 * The other four — Surat, Pune, Ahmedabad, Chennai — have no sheet. Ops answered
 * "All Surat", "All Pune", "All Ahmedabad", "All Chennai", which is a scope
 * rather than a list, so `scripts/generate-pickup-pincodes.ts` turned it into
 * one: it sweeps the city's postal series against India Post and keeps the codes
 * that answer. A scope names a city, not a district, so the rural talukas beyond
 * it stay out — Pune's 412xxx, and Ahmedabad's Dholka, Bavla, Dhandhuka and
 * Viramgam, which are 40 to 90 km from the counter and were never what "all of
 * it" meant.
 *
 * What the derived lists cannot tell us is where a rider actually stops. They
 * are right about which pincodes exist and where the postal city ends; whether
 * anyone is routed to the far edge of it is ops' answer to give.
 *
 * Nothing outside the table matches. There is no "all of <city>" fallback and
 * no numeric range: a dead pincode should fail the check, not inherit a promise
 * from its neighbours.
 *
 * ── Cutoffs ─────────────────────────────────────────────────────────────────
 *
 * Each beat carries its own. Riders out of Fort and Andheri work until 7 PM;
 * Delhi, Surat, Pune, Ahmedabad, Jaipur and Chennai until 5; Hyderabad until 3.
 * Kolkata is the last hub holding the conservative default, for want of an
 * answer. Booking past a beat's cutoff pushes collection to the next day, so the
 * date picker has to ask the pincode, not a global constant.
 *
 * One cutoff is deliberately not modelled. Delhi's three riders do not keep the
 * same hours — Ayan Khan stops at 3 PM where Ranjeet Yadav and Puneet Verma work
 * until 5 — but all three cover the same attached list, so the latest hour wins
 * for every Delhi pincode either way. Splitting Delhi into three beats with
 * identical rows would trade 194 duplicated rows for a distinction no customer
 * could ever observe.
 *
 * Where beats overlap — and Andheri's nine overlap heavily by design — the
 * customer gets the latest cutoff among them. If one rider is out until 7, same
 * day is genuinely possible until 7.
 *
 * ── Remarks ─────────────────────────────────────────────────────────────────
 *
 * Within Kolkata the sheet marks some pincodes "OUT OF CITY (CHARGE WILL BE
 * EXTRA)": the agent still comes, but the run is outside the hub's normal beat
 * and costs more. We surface that as a warning before the customer commits, not
 * as a block. The amount is not fixed here — it is settled when the parcel is
 * weighed — so the notice names the charge without a number. A plain beat
 * covering the same pincode cancels the warning: if anyone reaches the address
 * on a normal round, there is no surcharge to warn about.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 *
 * Rider names and phone numbers. This file is bundled to the browser and staff
 * names are internal; the roster lives in the seed migration and in
 * docs/final-phase/markdowns/open-items.md. Which rider takes a job is settled
 * after the booking exists — the beats narrow who gets notified, and the
 * customer gets a contact from the assigned-agent flow, not from here.
 *
 * The company has branches in cities with no beat still (Bangalore, Goa,
 * Cochin, Navsari, Thane's own counter). A branch office is not a pickup beat,
 * and nothing has been handed over for them — see `branches.ts`, which is what
 * a customer outside all of this is shown instead.
 */

import { PICKUP_CUTOFF_HOUR } from './istTime.js';

export type PickupRemark = 'ok' | 'out_of_city';

export interface PickupArea {
  /** City as the customer would name it, not the hub the rider drives from. */
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

/**
 * `[pincode, area, 1 if out-of-city surcharge applies]`, and optionally the
 * city — which a row carries only when it differs from its beat's.
 *
 * That fourth element exists for one real case: the Ghatkopar rounds run out of
 * Andheri but collect in Thane and Navi Mumbai, and telling that customer
 * "Thane is just outside Mumbai city limits" would be nonsense. The beat names
 * where the rider starts; the row names where the parcel is.
 */
type Row =
  | readonly [pincode: string, area: string, surcharge: 0 | 1]
  | readonly [pincode: string, area: string, surcharge: 0 | 1, city: string];

/**
 * A beat — one rider's round, which is the unit ops actually hand over.
 *
 * `hub` is the office the round starts from and is internal; `city` is the
 * default a row inherits when it does not name its own. Beats overlap freely:
 * the nine Andheri rounds share pincodes on purpose, and `resolveCoverage` is
 * what turns several beats' answers into the single one a customer is given.
 */
export interface PickupBeat {
  /** Stable id. The seed migration keys on this, so it must not be renamed. */
  slug: string;
  /** The round as ops describe it. */
  name: string;
  /** Office the riders run out of. Internal. */
  hub: string;
  /** Customer-facing city for every row that does not override it. */
  city: string;
  cutoffHour: number;
  rows: readonly Row[];
}

// ── Hubs handed over as lists ────────────────────────────────────────────────

/**
 * Kolkata, and the only sheet that came with remarks. Forty-four of these are
 * marked "OUT OF CITY (CHARGE WILL BE EXTRA)": the rider still comes, the run
 * is outside the normal round, and the amount is settled at the weighing.
 */
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
 * Mumbai — Fort hub, three rounds and a floater.
 *
 * Ops have always described Fort per rider; for a long time all that reached us
 * was the union, and this file said so. The 8 Sep roster finally carried the
 * splits, and they reconstruct that union exactly — eighteen pincodes, no code
 * gained or lost — so this is a change to who gets told about a job, not to
 * what any customer is offered.
 *
 * The round names are descriptive, derived from the pincode spans. Ops gave
 * names and numbers, not round names, and no locality names have ever come with
 * this hub — which is why every row's `area` still reads "Fort".
 *
 * 400008 sits in two rounds. That is ops' own overlap, not a transcription
 * slip, and `resolveCoverage` handles it like any other.
 *
 * The fourth rider is not a round at all: ops describe him as "THIS IS BICKER
 * (lifting loads any where)" — a biker who covers wherever he is needed. He is
 * modelled as membership of all three beats rather than a beat of his own,
 * because he has no territory to name.
 */
const FORT_GIRGAUM_TARDEO: readonly Row[] = [
  ['400004', 'Fort', 0],
  ['400006', 'Fort', 0],
  ['400007', 'Fort', 0],
  ['400008', 'Fort', 0],
  ['400026', 'Fort', 0],
  ['400034', 'Fort', 0],
  ['400036', 'Fort', 0],
];

const FORT_KALBADEVI_MAZGAON: readonly Row[] = [
  ['400002', 'Fort', 0],
  ['400003', 'Fort', 0],
  ['400008', 'Fort', 0],
  ['400009', 'Fort', 0],
  ['400010', 'Fort', 0],
  ['400020', 'Fort', 0],
];

const FORT_COLABA_BALLARD: readonly Row[] = [
  ['400001', 'Fort', 0],
  ['400005', 'Fort', 0],
  ['400021', 'Fort', 0],
  ['400023', 'Fort', 0],
  ['400038', 'Fort', 0],
  ['400039', 'Fort', 0],
];

/**
 * Hyderabad. Ops gave this as one span, 500001-500089, and drew that boundary
 * themselves — it is not the whole 500 block and we do not widen it to one.
 *
 * Written out row by row rather than held as a numeric range. The range was a
 * special case in the lookup that no other hub needed, and a beat that cannot
 * be listed cannot be seeded, edited in the ops console, or asked "who covers
 * this pincode?" like the rest of them.
 */
const HYDERABAD: readonly Row[] = [
  ['500001', 'Hyderabad', 0],
  ['500002', 'Hyderabad', 0],
  ['500003', 'Hyderabad', 0],
  ['500004', 'Hyderabad', 0],
  ['500005', 'Hyderabad', 0],
  ['500006', 'Hyderabad', 0],
  ['500007', 'Hyderabad', 0],
  ['500008', 'Hyderabad', 0],
  ['500009', 'Hyderabad', 0],
  ['500010', 'Hyderabad', 0],
  ['500011', 'Hyderabad', 0],
  ['500012', 'Hyderabad', 0],
  ['500013', 'Hyderabad', 0],
  ['500014', 'Hyderabad', 0],
  ['500015', 'Hyderabad', 0],
  ['500016', 'Hyderabad', 0],
  ['500017', 'Hyderabad', 0],
  ['500018', 'Hyderabad', 0],
  ['500019', 'Hyderabad', 0],
  ['500020', 'Hyderabad', 0],
  ['500021', 'Hyderabad', 0],
  ['500022', 'Hyderabad', 0],
  ['500023', 'Hyderabad', 0],
  ['500024', 'Hyderabad', 0],
  ['500025', 'Hyderabad', 0],
  ['500026', 'Hyderabad', 0],
  ['500027', 'Hyderabad', 0],
  ['500028', 'Hyderabad', 0],
  ['500029', 'Hyderabad', 0],
  ['500030', 'Hyderabad', 0],
  ['500031', 'Hyderabad', 0],
  ['500032', 'Hyderabad', 0],
  ['500033', 'Hyderabad', 0],
  ['500034', 'Hyderabad', 0],
  ['500035', 'Hyderabad', 0],
  ['500036', 'Hyderabad', 0],
  ['500037', 'Hyderabad', 0],
  ['500038', 'Hyderabad', 0],
  ['500039', 'Hyderabad', 0],
  ['500040', 'Hyderabad', 0],
  ['500041', 'Hyderabad', 0],
  ['500042', 'Hyderabad', 0],
  ['500043', 'Hyderabad', 0],
  ['500044', 'Hyderabad', 0],
  ['500045', 'Hyderabad', 0],
  ['500046', 'Hyderabad', 0],
  ['500047', 'Hyderabad', 0],
  ['500048', 'Hyderabad', 0],
  ['500049', 'Hyderabad', 0],
  ['500050', 'Hyderabad', 0],
  ['500051', 'Hyderabad', 0],
  ['500052', 'Hyderabad', 0],
  ['500053', 'Hyderabad', 0],
  ['500054', 'Hyderabad', 0],
  ['500055', 'Hyderabad', 0],
  ['500056', 'Hyderabad', 0],
  ['500057', 'Hyderabad', 0],
  ['500058', 'Hyderabad', 0],
  ['500059', 'Hyderabad', 0],
  ['500060', 'Hyderabad', 0],
  ['500061', 'Hyderabad', 0],
  ['500062', 'Hyderabad', 0],
  ['500063', 'Hyderabad', 0],
  ['500064', 'Hyderabad', 0],
  ['500065', 'Hyderabad', 0],
  ['500066', 'Hyderabad', 0],
  ['500067', 'Hyderabad', 0],
  ['500068', 'Hyderabad', 0],
  ['500069', 'Hyderabad', 0],
  ['500070', 'Hyderabad', 0],
  ['500071', 'Hyderabad', 0],
  ['500072', 'Hyderabad', 0],
  ['500073', 'Hyderabad', 0],
  ['500074', 'Hyderabad', 0],
  ['500075', 'Hyderabad', 0],
  ['500076', 'Hyderabad', 0],
  ['500077', 'Hyderabad', 0],
  ['500078', 'Hyderabad', 0],
  ['500079', 'Hyderabad', 0],
  ['500080', 'Hyderabad', 0],
  ['500081', 'Hyderabad', 0],
  ['500082', 'Hyderabad', 0],
  ['500083', 'Hyderabad', 0],
  ['500084', 'Hyderabad', 0],
  ['500085', 'Hyderabad', 0],
  ['500086', 'Hyderabad', 0],
  ['500087', 'Hyderabad', 0],
  ['500088', 'Hyderabad', 0],
  ['500089', 'Hyderabad', 0],
];

// ── Hubs given as a scope, resolved against India Post ───────────────────────

/**
 * Surat — "All Surat", per ops, worked two riders deep with a 5 PM cutoff.
 *
 * That reads as the 395xxx city block, plus the two 394xxx codes on the Udhna
 * and Sachin belt: city ground carrying a district number, which a blanket
 * 395001-395999 range would have missed.
 */
const SURAT: readonly Row[] = [
  ['394210', 'Surat', 0],
  ['394221', 'Surat', 0],
  ['395001', 'Surat', 0],
  ['395002', 'Surat', 0],
  ['395003', 'Surat', 0],
  ['395004', 'Surat', 0],
  ['395005', 'Surat', 0],
  ['395006', 'Surat', 0],
  ['395007', 'Surat', 0],
  ['395008', 'Surat', 0],
  ['395009', 'Surat', 0],
  ['395010', 'Surat', 0],
  ['395011', 'Surat', 0],
  ['395012', 'Surat', 0],
  ['395013', 'Surat', 0],
  ['395017', 'Surat', 0],
  ['395023', 'Surat', 0],
];

/**
 * Pune — "All Pune", per ops, two riders and a 5 PM cutoff.
 *
 * The 411xxx block, which is the city together with PCMC. The rural district
 * is 412xxx and stays out: "All Pune" is a city, not a district, and Maval and
 * Junnar are an hour and more from the hub.
 */
const PUNE: readonly Row[] = [
  ['411001', 'Pune', 0],
  ['411002', 'Pune', 0],
  ['411003', 'Pune', 0],
  ['411004', 'Pune', 0],
  ['411005', 'Pune', 0],
  ['411006', 'Pune', 0],
  ['411007', 'Pune', 0],
  ['411008', 'Pune', 0],
  ['411009', 'Pune', 0],
  ['411011', 'Pune', 0],
  ['411012', 'Pune', 0],
  ['411013', 'Pune', 0],
  ['411014', 'Pune', 0],
  ['411015', 'Pune', 0],
  ['411016', 'Pune', 0],
  ['411017', 'Pune', 0],
  ['411018', 'Pune', 0],
  ['411019', 'Pune', 0],
  ['411020', 'Pune', 0],
  ['411021', 'Pune', 0],
  ['411022', 'Pune', 0],
  ['411023', 'Pune', 0],
  ['411024', 'Pune', 0],
  ['411025', 'Pune', 0],
  ['411026', 'Pune', 0],
  ['411027', 'Pune', 0],
  ['411028', 'Pune', 0],
  ['411030', 'Pune', 0],
  ['411031', 'Pune', 0],
  ['411032', 'Pune', 0],
  ['411033', 'Pune', 0],
  ['411034', 'Pune', 0],
  ['411035', 'Pune', 0],
  ['411036', 'Pune', 0],
  ['411037', 'Pune', 0],
  ['411038', 'Pune', 0],
  ['411039', 'Pune', 0],
  ['411040', 'Pune', 0],
  ['411041', 'Pune', 0],
  ['411042', 'Pune', 0],
  ['411043', 'Pune', 0],
  ['411044', 'Pune', 0],
  ['411045', 'Pune', 0],
  ['411046', 'Pune', 0],
  ['411047', 'Pune', 0],
  ['411048', 'Pune', 0],
  ['411051', 'Pune', 0],
  ['411052', 'Pune', 0],
  ['411057', 'Pune', 0],
  ['411058', 'Pune', 0],
  ['411060', 'Pune', 0],
  ['411061', 'Pune', 0],
  ['411062', 'Pune', 0],
];

/**
 * Chennai — the whole 600xxx metro block, and the one hub ops have not spoken
 * for: no rider roster, no cutoff, no confirmation of scope. Derived on the
 * same reading as Surat and Pune, but on nobody's word.
 *
 * It spans three postal districts
 * (Chennai, Kanchipuram, Tiruvallur) only because India Post's district names
 * predate the 2018 redraw; Chromepet and Perungudi are Greater Chennai in
 * everything but that field, so filtering on district would have dropped half
 * the city. Chengalpattu proper starts at 603xxx and is not here.
 */
const CHENNAI: readonly Row[] = [
  ['600001', 'Chennai', 0],
  ['600002', 'Chennai', 0],
  ['600003', 'Chennai', 0],
  ['600004', 'Chennai', 0],
  ['600005', 'Chennai', 0],
  ['600006', 'Chennai', 0],
  ['600007', 'Chennai', 0],
  ['600008', 'Chennai', 0],
  ['600009', 'Chennai', 0],
  ['600010', 'Chennai', 0],
  ['600011', 'Chennai', 0],
  ['600012', 'Chennai', 0],
  ['600013', 'Chennai', 0],
  ['600014', 'Chennai', 0],
  ['600015', 'Chennai', 0],
  ['600016', 'Chennai', 0],
  ['600017', 'Chennai', 0],
  ['600018', 'Chennai', 0],
  ['600019', 'Chennai', 0],
  ['600020', 'Chennai', 0],
  ['600021', 'Chennai', 0],
  ['600022', 'Chennai', 0],
  ['600023', 'Chennai', 0],
  ['600024', 'Chennai', 0],
  ['600025', 'Chennai', 0],
  ['600026', 'Chennai', 0],
  ['600028', 'Chennai', 0],
  ['600029', 'Chennai', 0],
  ['600030', 'Chennai', 0],
  ['600031', 'Chennai', 0],
  ['600032', 'Chennai', 0],
  ['600033', 'Chennai', 0],
  ['600034', 'Chennai', 0],
  ['600035', 'Chennai', 0],
  ['600036', 'Chennai', 0],
  ['600037', 'Chennai', 0],
  ['600038', 'Chennai', 0],
  ['600039', 'Chennai', 0],
  ['600040', 'Chennai', 0],
  ['600041', 'Chennai', 0],
  ['600042', 'Chennai', 0],
  ['600043', 'Chennai', 0],
  ['600044', 'Chennai', 0],
  ['600045', 'Chennai', 0],
  ['600046', 'Chennai', 0],
  ['600047', 'Chennai', 0],
  ['600048', 'Chennai', 0],
  ['600049', 'Chennai', 0],
  ['600050', 'Chennai', 0],
  ['600051', 'Chennai', 0],
  ['600052', 'Chennai', 0],
  ['600053', 'Chennai', 0],
  ['600054', 'Chennai', 0],
  ['600055', 'Chennai', 0],
  ['600056', 'Chennai', 0],
  ['600057', 'Chennai', 0],
  ['600058', 'Chennai', 0],
  ['600059', 'Chennai', 0],
  ['600060', 'Chennai', 0],
  ['600061', 'Chennai', 0],
  ['600062', 'Chennai', 0],
  ['600063', 'Chennai', 0],
  ['600064', 'Chennai', 0],
  ['600065', 'Chennai', 0],
  ['600066', 'Chennai', 0],
  ['600067', 'Chennai', 0],
  ['600068', 'Chennai', 0],
  ['600069', 'Chennai', 0],
  ['600070', 'Chennai', 0],
  ['600071', 'Chennai', 0],
  ['600072', 'Chennai', 0],
  ['600073', 'Chennai', 0],
  ['600074', 'Chennai', 0],
  ['600075', 'Chennai', 0],
  ['600076', 'Chennai', 0],
  ['600077', 'Chennai', 0],
  ['600078', 'Chennai', 0],
  ['600081', 'Chennai', 0],
  ['600082', 'Chennai', 0],
  ['600083', 'Chennai', 0],
  ['600084', 'Chennai', 0],
  ['600085', 'Chennai', 0],
  ['600086', 'Chennai', 0],
  ['600087', 'Chennai', 0],
  ['600088', 'Chennai', 0],
  ['600089', 'Chennai', 0],
  ['600090', 'Chennai', 0],
  ['600091', 'Chennai', 0],
  ['600092', 'Chennai', 0],
  ['600093', 'Chennai', 0],
  ['600094', 'Chennai', 0],
  ['600095', 'Chennai', 0],
  ['600096', 'Chennai', 0],
  ['600097', 'Chennai', 0],
  ['600098', 'Chennai', 0],
  ['600099', 'Chennai', 0],
  ['600100', 'Chennai', 0],
  ['600101', 'Chennai', 0],
  ['600102', 'Chennai', 0],
  ['600103', 'Chennai', 0],
  ['600104', 'Chennai', 0],
  ['600106', 'Chennai', 0],
  ['600107', 'Chennai', 0],
  ['600110', 'Chennai', 0],
  ['600113', 'Chennai', 0],
  ['600115', 'Chennai', 0],
  ['600116', 'Chennai', 0],
  ['600117', 'Chennai', 0],
  ['600118', 'Chennai', 0],
  ['600119', 'Chennai', 0],
  ['600120', 'Chennai', 0],
  ['600122', 'Chennai', 0],
  ['600123', 'Chennai', 0],
  ['600124', 'Chennai', 0],
  ['600125', 'Chennai', 0],
  ['600126', 'Chennai', 0],
  ['600127', 'Chennai', 0],
  ['600128', 'Chennai', 0],
  ['600129', 'Chennai', 0],
  ['600130', 'Chennai', 0],
];

/**
 * Ahmedabad — "All Ahmedabad", one rider, 5 PM. Derived like Surat and Pune.
 *
 * 380xxx is the city. 382xxx is swept too, because the eastern industrial belt
 * — Naroda, Nikol, Odhav, Vatva, Kathwada — is Ahmedabad city ground on a
 * district number, the same shape as Surat's 394xxx tail.
 *
 * Two things are deliberately not here. Gandhinagar sits inside the swept range
 * at 382010: a different city with its own counter, kept out by the district
 * test. And the rural talukas that share the 382 series — Dholka, Bavla,
 * Dhandhuka, Barwala, Viramgam, Sanand town, Detroj — are 40 to 90 km from
 * Navrangpura and are not what "all of Ahmedabad" meant, on the same reading
 * that keeps Pune's 412xxx out. India Post's block is what separates them:
 * Ahmadabad City and Daskroi are the city, everything else is the district.
 */
const AHMEDABAD: readonly Row[] = [
  ['380001', 'Ahmedabad', 0],
  ['380002', 'Ahmedabad', 0],
  ['380004', 'Ahmedabad', 0],
  ['380005', 'Ahmedabad', 0],
  ['380006', 'Ahmedabad', 0],
  ['380007', 'Ahmedabad', 0],
  ['380008', 'Ahmedabad', 0],
  ['380009', 'Ahmedabad', 0],
  ['380013', 'Ahmedabad', 0],
  ['380014', 'Ahmedabad', 0],
  ['380015', 'Ahmedabad', 0],
  ['380016', 'Ahmedabad', 0],
  ['380018', 'Ahmedabad', 0],
  ['380019', 'Ahmedabad', 0],
  ['380021', 'Ahmedabad', 0],
  ['380022', 'Ahmedabad', 0],
  ['380023', 'Ahmedabad', 0],
  ['380024', 'Ahmedabad', 0],
  ['380026', 'Ahmedabad', 0],
  ['380027', 'Ahmedabad', 0],
  ['380028', 'Ahmedabad', 0],
  ['380050', 'Ahmedabad', 0],
  ['380051', 'Ahmedabad', 0],
  ['380052', 'Ahmedabad', 0],
  ['380054', 'Ahmedabad', 0],
  ['380055', 'Ahmedabad', 0],
  ['380058', 'Ahmedabad', 0],
  ['380059', 'Ahmedabad', 0],
  ['380060', 'Ahmedabad', 0],
  ['380061', 'Ahmedabad', 0],
  ['380063', 'Ahmedabad', 0],
  ['382330', 'Ahmedabad', 0],
  ['382340', 'Ahmedabad', 0],
  ['382345', 'Ahmedabad', 0],
  ['382350', 'Ahmedabad', 0],
  ['382405', 'Ahmedabad', 0],
  ['382415', 'Ahmedabad', 0],
  ['382418', 'Ahmedabad', 0],
  ['382425', 'Ahmedabad', 0],
  ['382427', 'Ahmedabad', 0],
  ['382430', 'Ahmedabad', 0],
  ['382433', 'Ahmedabad', 0],
  ['382435', 'Ahmedabad', 0],
  ['382440', 'Ahmedabad', 0],
  ['382443', 'Ahmedabad', 0],
  ['382445', 'Ahmedabad', 0],
  ['382449', 'Ahmedabad', 0],
  ['382470', 'Ahmedabad', 0],
  ['382475', 'Ahmedabad', 0],
  ['382480', 'Ahmedabad', 0],
  ['382481', 'Ahmedabad', 0],
];

/**
 * Jaipur — one rider, 5 PM, and a sheet of 143 post offices resolving to 69
 * pincodes. Ops sent it without remarks, so it is taken at face value and every
 * row reads plainly serviceable, including the 303xxx tail that runs an hour
 * and more out of the city. Where several offices share a pincode the label is
 * the head or sub office, not whichever branch sorted first.
 */
const JAIPUR: readonly Row[] = [
  ['302001', 'Jaipur GPO', 0],
  ['302002', 'Amer Road', 0],
  ['302003', 'Jaipur City', 0],
  ['302004', 'Jawahar Nagar HO', 0],
  ['302005', 'N.C.R. Building', 0],
  ['302006', 'Ajmer Road', 0],
  ['302012', 'Jhotwara', 0],
  ['302013', 'Harmada', 0],
  ['302015', 'Gandhi Nagar', 0],
  ['302016', 'Shastri Nagar HO', 0],
  ['302017', 'Jagatpura', 0],
  ['302018', 'Amer Clark Hotel', 0],
  ['302019', 'Shyam Nagar', 0],
  ['302020', 'Kaveri Path Mansarovar', 0],
  ['302021', 'Vaishali Nagar', 0],
  ['302022', 'Sitapura Industrial Area', 0],
  ['302025', 'Jagatpura', 0],
  ['302026', 'Bhankrota', 0],
  ['302027', 'Jaisinghpura Khore', 0],
  ['302028', 'Amer', 0],
  ['302029', 'Airport Sanganer', 0],
  ['302031', 'Jamdoli', 0],
  ['302033', 'Pratap Nagar Housing Board', 0],
  ['302034', 'Panchyawala', 0],
  ['302037', 'Mahindra World City', 0],
  ['302038', 'Kookas', 0],
  ['302039', 'Amba Bari', 0],
  ['302041', 'Bindayaka', 0],
  ['303001', 'Andhi', 0],
  ['303002', 'Achrol', 0],
  ['303003', 'Talba Bihajar', 0],
  ['303004', 'Lawain', 0],
  ['303005', 'Phagi', 0],
  ['303006', 'Madhorajpura', 0],
  ['303007', 'Ajairajpura', 0],
  ['303008', 'Sirohi Kalan', 0],
  ['303009', 'Sanwali', 0],
  ['303102', 'Sothana', 0],
  ['303103', 'Badi Jori', 0],
  ['303104', 'Sirohi', 0],
  ['303105', 'Suklawas', 0],
  ['303106', 'Paota', 0],
  ['303107', 'Suderpura Dhadha', 0],
  ['303108', 'Sunderpura', 0],
  ['303119', 'Antela', 0],
  ['303120', 'Amloda', 0],
  ['303123', 'Bhainsawa', 0],
  ['303302', 'Anantpura', 0],
  ['303305', 'Badwa', 0],
  ['303329', 'A C Jobner', 0],
  ['303338', 'Akoda', 0],
  ['303348', 'Srirampura', 0],
  ['303509', 'Udaipuria', 0],
  ['303601', 'Amarsar', 0],
  ['303602', 'Badhal', 0],
  ['303603', 'Bagawas', 0],
  ['303604', 'Asalpur', 0],
  ['303701', 'Chatarpura', 0],
  ['303702', 'Sirsali', 0],
  ['303704', 'Anantpura', 0],
  ['303706', 'Bhamori', 0],
  ['303712', 'Anantpura', 0],
  ['303801', 'Alisar', 0],
  ['303804', 'Amarpura', 0],
  ['303805', 'Bagwara', 0],
  ['303901', 'Akodiya', 0],
  ['303903', 'Badapadampura', 0],
  ['303904', 'Panwalia', 0],
  ['303908', 'Achalpura', 0],
];

// ── Andheri ─────────────────────────────────────────────────────────────────

/**
 * The Mumbai suburban hub, and the first ops have ever given us round by round
 * rather than as one city list. Ten riders run nine rounds — two of them share
 * the Andheri East to Powai beat — and the rounds overlap heavily by design,
 * which is what `resolveCoverage` exists to reconcile.
 *
 * The email's own boundary note is respected rather than widened. It says
 * pickups "OUT OF THANE NEW MUBAI AND MIRA ROAD VASA[I]" happen "IF POSSIBLE";
 * the sheet stops at Mandapeshwar (400103) and names no 401xxx pincode, so
 * neither do we. Bhayandar, Mira Road and Vasai are not covered here even
 * though the first round's route text reaches toward them.
 */

/** Jogeshwari to Borivali, east and west. */
const ANDHERI_JOGESHWARI_BORIVALI: readonly Row[] = [
  ['400053', 'Andheri / Azad Nagar', 0],
  ['400058', 'Andheri Railway Station', 0],
  ['400060', 'Jogeshwari East / Meghwadi / Majas / Mogra', 0],
  ['400061', 'Versova / Vesava', 0],
  ['400062', 'Goregaon West', 0],
  ['400063', 'Goregaon East', 0],
  ['400064', 'Malad / Malad West', 0],
  ['400065', 'Aarey Milk Colony', 0],
  ['400066', 'Borivali East', 0],
  ['400067', 'Kandivali West / Charkop', 0],
  ['400090', 'Bangur Nagar', 0],
  ['400091', 'Borivali HPO', 0],
  ['400092', 'Borivali West', 0],
  ['400095', 'Kharodi', 0],
  ['400097', 'Malad East', 0],
  ['400101', 'Kandivali East', 0],
  ['400102', 'Jogeshwari West', 0],
  ['400103', 'Mandapeshwar', 0],
  ['400104', 'Motilal Nagar', 0],
];

/** Jogeshwari to Kandivali, east and west. */
const ANDHERI_JOGESHWARI_KANDIVALI: readonly Row[] = [
  ['400060', 'Jogeshwari East / Meghwadi / Majas / Mogra', 0],
  ['400062', 'Goregaon West', 0],
  ['400063', 'Goregaon East', 0],
  ['400064', 'Malad / Malad West', 0],
  ['400065', 'Aarey Milk Colony', 0],
  ['400067', 'Kandivali West / Charkop', 0],
  ['400095', 'Kharodi', 0],
  ['400097', 'Malad East', 0],
  ['400101', 'Kandivali East', 0],
  ['400102', 'Jogeshwari West', 0],
];

/** Andheri East to Powai. */
const ANDHERI_EAST_POWAI: readonly Row[] = [
  ['400059', 'J.B. Nagar / J.B. Nagar area', 0],
  ['400069', 'Andheri East', 0],
  ['400072', 'Sakinaka', 0],
  ['400076', 'Powai / IIT', 0],
  ['400078', 'Bhandup West', 0],
  ['400079', 'Vikhroli', 0],
  ['400080', 'Mulund West', 0],
  ['400081', 'Mulund East', 0],
  ['400083', 'Tagore Nagar', 0],
  ['400085', 'BARC', 0],
  ['400087', 'NITIE / IIM area', 0],
  ['400093', 'Chakala MIDC', 0],
  ['400096', 'SEEPZ', 0],
  ['400099', 'Sahar / Airport area', 0],
];

/** Andheri West to Vile Parle, east and west, and Juhu. */
const ANDHERI_WEST_VILE_PARLE_JUHU: readonly Row[] = [
  ['400049', 'Juhu', 0],
  ['400053', 'Andheri / Azad Nagar', 0],
  ['400056', 'Vile Parle West', 0],
  ['400057', 'Vile Parle East', 0],
  ['400058', 'Andheri Railway Station', 0],
  ['400061', 'Versova / Vesava', 0],
];

/** Vile Parle to Bandra, east and west. */
const ANDHERI_VILE_PARLE_BANDRA: readonly Row[] = [
  ['400029', 'Santacruz P&T Colony', 0],
  ['400050', 'Bandra West', 0],
  ['400051', 'Bandra East', 0],
  ['400052', 'Khar / Khar West', 0],
  ['400054', 'Santacruz West', 0],
  ['400055', 'Santacruz East', 0],
  ['400056', 'Vile Parle West', 0],
  ['400057', 'Vile Parle East', 0],
];

/** Andheri West to Bandra, east and west. */
const ANDHERI_WEST_BANDRA: readonly Row[] = [
  ['400049', 'Juhu', 0],
  ['400050', 'Bandra West', 0],
  ['400051', 'Bandra East', 0],
  ['400052', 'Khar / Khar West', 0],
  ['400053', 'Andheri / Azad Nagar', 0],
  ['400054', 'Santacruz West', 0],
  ['400055', 'Santacruz East', 0],
  ['400056', 'Vile Parle West', 0],
  ['400057', 'Vile Parle East', 0],
  ['400058', 'Andheri Railway Station', 0],
];

/** Chembur to Ghatkopar, Kurla and Vashi. */
const ANDHERI_CHEMBUR_GHATKOPAR_VASHI: readonly Row[] = [
  ['400070', 'Kurla', 0],
  ['400071', 'Chembur', 0],
  ['400072', 'Sakinaka', 0],
  ['400074', 'FCI', 0],
  ['400075', 'Pant Nagar', 0],
  ['400077', 'Rajawadi', 0],
  ['400086', 'Ghatkopar West', 0],
  ['400089', 'Tilak Nagar', 0],
  ['400094', 'Anushakti Nagar', 0],
  ['400703', 'Vashi / Vashi Sec-26 / Turbhe', 0, 'Navi Mumbai'],
];

/** Ghatkopar to Thane, east and west, via Kurla, Chembur, Vashi and Airoli. */
const ANDHERI_GHATKOPAR_THANE_KURLA: readonly Row[] = [
  ['400070', 'Kurla', 0],
  ['400071', 'Chembur', 0],
  ['400077', 'Rajawadi', 0],
  ['400086', 'Ghatkopar West', 0],
  ['400601', 'Thane / Thane HO', 0, 'Thane'],
  ['400602', 'Naupada', 0, 'Thane'],
  ['400603', 'Thane East / Kopri Colony', 0, 'Thane'],
  ['400604', 'Wagle Estate', 0, 'Thane'],
  ['400606', 'Jekegram', 0, 'Thane'],
  ['400607', 'Chitalsar Manpada', 0, 'Thane'],
  ['400703', 'Vashi / Turbhe', 0, 'Navi Mumbai'],
  ['400708', 'Airoli', 0, 'Navi Mumbai'],
  ['400710', 'Millennium Business Park', 0, 'Navi Mumbai'],
];

/** Ghatkopar to Thane, east and west, via Vashi and Airoli. */
const ANDHERI_GHATKOPAR_THANE_VASHI: readonly Row[] = [
  ['400077', 'Rajawadi', 0],
  ['400086', 'Ghatkopar West', 0],
  ['400601', 'Thane / Thane HO', 0, 'Thane'],
  ['400602', 'Naupada', 0, 'Thane'],
  ['400603', 'Thane East / Kopri Colony', 0, 'Thane'],
  ['400703', 'Vashi / Turbhe', 0, 'Navi Mumbai'],
  ['400708', 'Airoli', 0, 'Navi Mumbai'],
];

/**
 * Every beat, and the whole of what this file knows.
 *
 * `slug` is the seam with the database: `migrations/seed_pickup_beats.sql` is
 * generated from this array and keys on it, so renaming one orphans its rows.
 */
export const PICKUP_BEATS: readonly PickupBeat[] = [
  {
    // Cutoff never came through with the roster, so it holds the conservative default.
    slug: 'kolkata',
    name: 'Kolkata',
    hub: 'Kolkata',
    city: 'Kolkata',
    cutoffHour: PICKUP_CUTOFF_HOUR,
    rows: KOLKATA,
  },
  {
    slug: 'delhi',
    name: 'Delhi',
    hub: 'Delhi',
    city: 'Delhi',
    cutoffHour: 17,
    rows: DELHI,
  },
  {
    slug: 'mumbai-fort-girgaum-tardeo',
    name: 'Girgaum to Tardeo and Nepean Sea Road',
    hub: 'Fort',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: FORT_GIRGAUM_TARDEO,
  },
  {
    slug: 'mumbai-fort-kalbadevi-mazgaon',
    name: 'Kalbadevi to Mazgaon and Churchgate',
    hub: 'Fort',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: FORT_KALBADEVI_MAZGAON,
  },
  {
    slug: 'mumbai-fort-colaba-ballard',
    name: 'Fort, Colaba, Nariman Point and Ballard Estate',
    hub: 'Fort',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: FORT_COLABA_BALLARD,
  },
  {
    // Ops have confirmed 3 PM, so it is written out rather than borrowed from the default it happens to equal.
    slug: 'hyderabad',
    name: 'Hyderabad',
    hub: 'Hyderabad',
    city: 'Hyderabad',
    cutoffHour: 15,
    rows: HYDERABAD,
  },
  {
    slug: 'surat',
    name: 'All Surat',
    hub: 'Surat',
    city: 'Surat',
    cutoffHour: 17,
    rows: SURAT,
  },
  {
    slug: 'pune',
    name: 'All Pune',
    hub: 'Pune',
    city: 'Pune',
    cutoffHour: 17,
    rows: PUNE,
  },
  {
    // Confirmed 5 PM on 8 Sep, with "All Chennai" and a named rider — this hub
    // held the conservative default for want of an answer until then.
    slug: 'chennai',
    name: 'All Chennai',
    hub: 'Chennai',
    city: 'Chennai',
    cutoffHour: 17,
    rows: CHENNAI,
  },
  {
    slug: 'ahmedabad',
    name: 'All Ahmedabad',
    hub: 'Ahmedabad',
    city: 'Ahmedabad',
    cutoffHour: 17,
    rows: AHMEDABAD,
  },
  {
    slug: 'jaipur',
    name: 'All Jaipur',
    hub: 'Jaipur',
    city: 'Jaipur',
    cutoffHour: 17,
    rows: JAIPUR,
  },
  {
    slug: 'andheri-jogeshwari-borivali',
    name: 'Jogeshwari → Borivali E/W',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_JOGESHWARI_BORIVALI,
  },
  {
    slug: 'andheri-jogeshwari-kandivali',
    name: 'Jogeshwari → Kandivali E/W',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_JOGESHWARI_KANDIVALI,
  },
  {
    slug: 'andheri-east-powai',
    name: 'Andheri East → Powai',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_EAST_POWAI,
  },
  {
    slug: 'andheri-west-vile-parle-juhu',
    name: 'Andheri West → Vile Parle E/W + Juhu',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_WEST_VILE_PARLE_JUHU,
  },
  {
    slug: 'andheri-vile-parle-bandra',
    name: 'Vile Parle → Bandra E/W',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_VILE_PARLE_BANDRA,
  },
  {
    slug: 'andheri-west-bandra',
    name: 'Andheri West → Bandra E/W',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_WEST_BANDRA,
  },
  {
    slug: 'andheri-chembur-ghatkopar-vashi',
    name: 'Chembur → Ghatkopar / Kurla / Vashi',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_CHEMBUR_GHATKOPAR_VASHI,
  },
  {
    slug: 'andheri-ghatkopar-thane-kurla',
    name: 'Ghatkopar → Thane E/W + Kurla/Chembur/Vashi/Airoli/',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_GHATKOPAR_THANE_KURLA,
  },
  {
    slug: 'andheri-ghatkopar-thane-vashi',
    name: 'Ghatkopar → Thane E/W + Vashi/Airoli',
    hub: 'Mumbai (Andheri)',
    city: 'Mumbai',
    cutoffHour: 19,
    rows: ANDHERI_GHATKOPAR_THANE_VASHI,
  },
];

// ── Resolution ───────────────────────────────────────────────────────────────

/** One beat's answer for one pincode, before overlapping beats are reconciled. */
export interface CoverageRow extends PickupArea {
  pincode: string;
}

/** Every row of every beat, flat. What the seed writes and the fallback indexes. */
export function flattenBeats(beats: readonly PickupBeat[] = PICKUP_BEATS): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (const beat of beats) {
    for (const [pincode, area, surcharge, city] of beat.rows) {
      rows.push({
        pincode,
        city: city ?? beat.city,
        area,
        remark: surcharge === 1 ? 'out_of_city' : 'ok',
        cutoffHour: beat.cutoffHour,
      });
    }
  }
  return rows;
}

/**
 * One answer from the several a pincode may have.
 *
 * Andheri's rounds overlap on purpose — 400077 sits in three of them — and a
 * customer needs one cutoff and one label, not a list. The rules, in order:
 *
 *   - the cutoff is the LATEST of them. If any rider covering this address
 *     works until 7 PM, same-day collection really is possible until 7 PM, and
 *     quoting an earlier hour would refuse a booking we could have honoured.
 *   - `ok` beats `out_of_city`. The surcharge warning means "no normal round
 *     reaches you"; if one does, there is nothing to warn about.
 *   - the label comes from the best row on that same reading, then by city and
 *     area, so repeated reads give the same answer rather than whichever row
 *     the database happened to return first.
 *
 * Callers must not pass an empty list; there is no coverage to resolve.
 */
export function resolveCoverage(candidates: readonly PickupArea[]): PickupArea {
  if (candidates.length === 0) {
    throw new Error('resolveCoverage: no candidates');
  }

  const remark: PickupRemark = candidates.some((c) => c.remark === 'ok') ? 'ok' : 'out_of_city';
  const cutoffHour = candidates.reduce((latest, c) => Math.max(latest, c.cutoffHour), 0);

  const label = [...candidates].sort((a, b) => {
    if (a.remark !== b.remark) return a.remark === 'ok' ? -1 : 1;
    return a.city.localeCompare(b.city) || a.area.localeCompare(b.area);
  })[0];

  return { city: label.city, area: label.area, remark, cutoffHour };
}

/**
 * Rows to the map every lookup here reads.
 *
 * The one place overlapping beats are reconciled, shared by the static tables
 * below and by `server/pickupCoverageDb.ts` reading the same rows out of
 * Postgres — so the fallback and the live answer cannot differ in their
 * reading, only in their rows.
 */
export function buildCoverage(rows: readonly CoverageRow[]): Map<string, PickupArea> {
  // Insertion order is tracked in a plain array rather than read back off the
  // Map: this compiles to ES5, where iterating a Map is not available.
  const grouped = new Map<string, PickupArea[]>();
  const pincodes: string[] = [];
  for (const row of rows) {
    const at = grouped.get(row.pincode);
    if (at) {
      at.push(row);
    } else {
      grouped.set(row.pincode, [row]);
      pincodes.push(row.pincode);
    }
  }

  const coverage = new Map<string, PickupArea>();
  for (const pincode of pincodes) {
    coverage.set(pincode, resolveCoverage(grouped.get(pincode) ?? []));
  }
  return coverage;
}

/** The compiled-in answer. Authority only when the database cannot be reached. */
export const STATIC_COVERAGE: ReadonlyMap<string, PickupArea> = buildCoverage(flattenBeats());

const SIX_DIGITS = /^[0-9]{6}$/;

function findArea(
  pincode: string | null | undefined,
  coverage: ReadonlyMap<string, PickupArea>
): PickupArea | null {
  const code = (pincode ?? '').trim();
  if (!SIX_DIGITS.test(code)) return null;
  return coverage.get(code) ?? null;
}

const NOT_SERVICEABLE: PickupServiceability = { serviceable: false };

// ── Lookups ──────────────────────────────────────────────────────────────────
//
// Each takes the coverage map to read, defaulting to the compiled-in one. The
// server passes the map it built from the database; the booking form passes the
// one `usePickupCoverage` fetched, which is seeded with this same default so
// the form is right on first paint and never waits on a request.

/** Where we collect from, in the customer's words. Copy only. */
export function pickupCities(
  coverage: ReadonlyMap<string, PickupArea> = STATIC_COVERAGE
): string[] {
  const seen: Record<string, true> = {};
  const cities: string[] = [];
  coverage.forEach((area) => {
    if (seen[area.city]) return;
    seen[area.city] = true;
    cities.push(area.city);
  });
  return cities.sort((a, b) => a.localeCompare(b));
}

/** "a, b and c" — for a sentence, not a list. */
export function formatPickupCities(
  coverage: ReadonlyMap<string, PickupArea> = STATIC_COVERAGE
): string {
  const cities = pickupCities(coverage);
  const last = cities.pop();
  if (!last) return '';
  return cities.length === 0 ? last : `${cities.join(', ')} and ${last}`;
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
export function getPickupServiceability(
  pincode: string | null | undefined,
  coverage: ReadonlyMap<string, PickupArea> = STATIC_COVERAGE
): PickupServiceability {
  const area = findArea(pincode, coverage);
  return area ? { serviceable: true, ...area } : NOT_SERVICEABLE;
}

/** True once `pincode` is a complete six-digit code we do not pick up from. */
export function isPickupBlocked(
  pincode: string | null | undefined,
  coverage: ReadonlyMap<string, PickupArea> = STATIC_COVERAGE
): boolean {
  const code = (pincode ?? '').trim();
  return SIX_DIGITS.test(code) && findArea(code, coverage) === null;
}

/**
 * The cutoff that applies to `pincode`, falling back to the conservative
 * default where no beat covers it — so a caller asking about an uncovered
 * pincode gets a real hour rather than a promise we cannot keep.
 */
export function pickupCutoffHour(
  pincode: string | null | undefined,
  coverage: ReadonlyMap<string, PickupArea> = STATIC_COVERAGE
): number {
  return findArea(pincode, coverage)?.cutoffHour ?? PICKUP_CUTOFF_HOUR;
}
