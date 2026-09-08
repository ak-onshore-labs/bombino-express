/**
 * Where a customer can hand a parcel in, and which counters to show them.
 *
 * Doorstep pickup runs out of seven hubs (see `pickupPincodes.ts`); everyone
 * else is told to drop the parcel off, and until now we told them that without
 * saying where. This is the answer to "where?".
 *
 * Deliberately not a "nearest branch" calculation. India's pincodes are
 * allocated geographically, but only loosely enough to mislead: Dombivli's
 * 421301 is numerically nearer Pune's 411011 than Thane's 400601, so ranking
 * on pincode distance would send a Mumbai-metro customer a hundred kilometres
 * the wrong way with a straight face. Nobody has coordinates for a pincode
 * here, and inventing confidence we do not have is worse than showing two
 * addresses and letting the customer pick the one they know.
 *
 * So: match on state, order within it, and show every counter in that state.
 * A state with no branch of its own maps to the one that serves the region.
 * The customer sees at most three addresses and always the right city.
 *
 * Source: the branch list on bombinoexp.com/contact. The Andheri head office
 * is not here on purpose — it is an office, not a parcel counter, and sending
 * someone to a desk that cannot weigh a shipment helps nobody.
 */

export interface Branch {
  /** Branch name as ops and the website say it. */
  city: string;
  /** Postal code of the counter itself. Orders the list within a state. */
  pincode: string;
  address: string;
  state: string;
  /**
   * Other names the same place answers to. India Post returns districts, which
   * do not always match the name on the door — "Bengaluru", "Ernakulam".
   */
  aliases?: readonly string[];
}

export const BRANCHES: readonly Branch[] = [
  {
    city: 'Mumbai (Fort)',
    pincode: '400001',
    state: 'Maharashtra',
    address: '42, Veer Nariman Road, Opposite Akbar Ally, Fort, Mumbai – 400 001',
    aliases: ['Mumbai', 'Fort', 'Bombay'],
  },
  {
    city: 'Thane',
    pincode: '400601',
    state: 'Maharashtra',
    address: 'Shop No. D1-20, Rutu Park, Brindavan Road, Majiwade, Thane (West) – 400 601',
  },
  {
    city: 'Pune',
    pincode: '411011',
    state: 'Maharashtra',
    address:
      'Sadanand Nagar Society B Wing, Shop No. 21, Ground Floor, Mangalwar Peth, Pune – 411 011',
  },
  {
    city: 'New Delhi',
    pincode: '110037',
    state: 'Delhi',
    address: 'A-89, Mezzanine Floor, Road No. 2, Mahipalpur Ext., New Delhi – 110 037',
    aliases: ['Delhi', 'South West Delhi', 'New Delhi'],
  },
  {
    city: 'Bangalore',
    pincode: '560025',
    state: 'Karnataka',
    address: 'No. 38, Richmond Road, Opp. Cathedral School, Bangalore – 560 025',
    aliases: ['Bengaluru'],
  },
  {
    city: 'Chennai',
    pincode: '600014',
    state: 'Tamil Nadu',
    address:
      'No. 23, Modern Tower, Ground Floor, Opp. Bata Showroom, West Cott Road, Royapettah, Chennai – 600 014',
    aliases: ['Madras'],
  },
  {
    city: 'Hyderabad',
    pincode: '500016',
    state: 'Telangana',
    address:
      'Shop No 2 B-7 F3, Prakash Nagar, Near Begumpet Airport, Post Office Lane, Hyderabad – 500 016',
  },
  {
    city: 'Kolkata',
    pincode: '700017',
    state: 'West Bengal',
    address: '29 B, Circus Row, Opp. Bombay Mercantile Bank, Kolkata – 700 017',
    aliases: ['Calcutta'],
  },
  {
    city: 'Ahmedabad',
    pincode: '380009',
    state: 'Gujarat',
    address:
      'Shop No. 4, 5, 6, Dev Ashish Building, Near Hotel Classic Gold, Sardar Patel Nagar, Navrangpura, Ahmedabad – 380 009',
  },
  {
    city: 'Surat',
    pincode: '395009',
    state: 'Gujarat',
    address:
      'Shivam Shopper, G-6, Gangeshwar Mahadev Temple Road, Western Park, Adajan, Surat – 395 009',
  },
  {
    city: 'Navsari',
    pincode: '396445',
    state: 'Gujarat',
    address:
      'Shop No. 2, Indraprastha Apartment, Zaveri Sadak, Nr. Naranlala Wadi, Navsari – 396 445',
  },
  {
    city: 'Jaipur',
    pincode: '302002',
    state: 'Rajasthan',
    address: 'Shop No. 281-B, Kishanpole Bazar Main Road, Jaipur – 302 002',
  },
  {
    city: 'Goa',
    pincode: '403001',
    state: 'Goa',
    address: '10, Ramakant Apt., 18th June Road, Opp. Bharat Petroleum Pump, Altinho, Panaji – 403 001',
    aliases: ['Panaji', 'North Goa', 'Panjim'],
  },
  {
    city: 'Cochin',
    pincode: '682024',
    state: 'Kerala',
    address:
      'Ground 37/2159, Manimala Prashanthi Nagar, Road No. 4, Edappally, Cochin, Ernakulam – 682 024',
    aliases: ['Kochi', 'Ernakulam'],
  },
];

/**
 * States with no branch, and the counter that serves them.
 *
 * Distances here are real ones, not pincode arithmetic: Indore is closer to
 * Ahmedabad than to Mumbai, Raipur closer to Kolkata than to Hyderabad. A
 * state left out of this map gets no suggestion at all, which is the honest
 * outcome — better silence than a counter three states away.
 */
const STATE_SERVED_BY: Readonly<Record<string, string>> = {
  // North — everything routes through Delhi.
  haryana: 'New Delhi',
  punjab: 'New Delhi',
  'uttar pradesh': 'New Delhi',
  uttarakhand: 'New Delhi',
  'himachal pradesh': 'New Delhi',
  'jammu and kashmir': 'New Delhi',
  ladakh: 'New Delhi',
  chandigarh: 'New Delhi',
  // East and north-east — Kolkata.
  bihar: 'Kolkata',
  jharkhand: 'Kolkata',
  odisha: 'Kolkata',
  orissa: 'Kolkata',
  chhattisgarh: 'Kolkata',
  assam: 'Kolkata',
  sikkim: 'Kolkata',
  meghalaya: 'Kolkata',
  manipur: 'Kolkata',
  mizoram: 'Kolkata',
  nagaland: 'Kolkata',
  tripura: 'Kolkata',
  'arunachal pradesh': 'Kolkata',
  // Central — Ahmedabad is the shorter run from most of MP.
  'madhya pradesh': 'Ahmedabad',
  // South.
  'andhra pradesh': 'Hyderabad',
  puducherry: 'Chennai',
  pondicherry: 'Chennai',
  'andaman and nicobar islands': 'Chennai',
  lakshadweep: 'Cochin',
  // The Gujarat enclaves.
  'dadra and nagar haveli': 'Surat',
  'daman and diu': 'Surat',
  'dadra and nagar haveli and daman and diu': 'Surat',
};

const norm = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Every name a branch answers to, for matching a looked-up district. */
function names(branch: Branch): string[] {
  return [branch.city, ...(branch.aliases ?? [])].map(norm);
}

/**
 * Counters worth showing someone posting from `pincode`, best first.
 *
 * `city` and `state` are what the pincode lookup filled in — the booking form
 * already has both, so this costs no round trip. Passing neither still works:
 * the pincode's own state is unknown, so the answer is an empty list rather
 * than a guess.
 *
 * Returns every branch in the customer's state, the one in their own city
 * first and the rest ordered by pincode. Where the state has no branch, the
 * single counter that serves the region.
 */
export function dropoffBranchesFor(
  pincode: string | null | undefined,
  city?: string | null,
  state?: string | null
): Branch[] {
  const stateKey = norm(state);
  const cityKey = norm(city);

  const inState = BRANCHES.filter((b) => norm(b.state) === stateKey);

  if (inState.length > 0) {
    // The customer's own city first — they know where it is — then the rest of
    // the state by pincode, which at least reads in a stable order.
    const home = inState.filter((b) => names(b).includes(cityKey));
    const others = inState
      .filter((b) => !names(b).includes(cityKey))
      .sort((a, b) => a.pincode.localeCompare(b.pincode));
    return [...home, ...others];
  }

  const served = STATE_SERVED_BY[stateKey];
  if (!served) return [];

  const branch = BRANCHES.find((b) => b.city === served);
  return branch ? [branch] : [];
}

/** A Google Maps search for a counter, for the "Directions" link. */
export function branchMapsUrl(branch: Branch): string {
  const query = `Bombino Express, ${branch.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
