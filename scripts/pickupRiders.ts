/**
 * The pickup riders ops have named, and the beats they run.
 *
 * IN `scripts/`, NOT `shared/`, ON PURPOSE. This file holds staff names and
 * personal mobile numbers. `shared/pickupPincodes.ts` is imported by
 * `CreateShipment.tsx` and ships to every customer's browser; nothing here may
 * ever follow it there. Both `generate-beat-seed.ts` and `seed-pickup-riders.ts`
 * read this, and neither runs in the browser.
 *
 * Source: Bombino technical support, "Pincode List", 8 Sep 2026, plus the
 * roster mail that followed it. Every entry is ops' own four-line block:
 *
 *     Pickup Boy Name :
 *     Pickup Boy Contact Number:
 *     Pickup Serviceable Pincodes
 *     Pickup Cut-off Time
 *
 * The cut-off lives on the beat (`PICKUP_BEATS`), and the serviceable pincodes
 * are the beat's rows, so what is left here is the half that identifies a
 * person: their name, their number, and which rounds they run.
 *
 * `beats` are slugs from `PICKUP_BEATS`. A rider on more than one is normal —
 * Fort's floater runs all three of that hub's rounds — and a beat with more
 * than one rider is equally normal.
 */

export interface PickupRider {
  full_name: string;
  /** Ten digits, no country code — `itd_users.phone` is the unique key. */
  phone: string;
  /** `INDIA_HUBS` id, for the ITD attribution the ops console also collects. */
  hub_id: number;
  /** Beat slugs from `PICKUP_BEATS`. */
  beats: readonly string[];
  /** Anything ops said that the model does not otherwise carry. */
  note?: string;
}

export const PICKUP_RIDERS: readonly PickupRider[] = [
  // ── Mumbai, Fort (hub 8) — 7 PM ──────────────────────────────────────────
  {
    full_name: 'Mohd. Sagir',
    phone: '7506516901',
    hub_id: 8,
    beats: ['mumbai-fort-girgaum-tardeo'],
  },
  {
    full_name: 'Siddharth Thorat',
    phone: '7506516906',
    hub_id: 8,
    beats: ['mumbai-fort-kalbadevi-mazgaon'],
  },
  {
    full_name: 'Suresh Bhangre',
    phone: '9867603072',
    hub_id: 8,
    beats: ['mumbai-fort-colaba-ballard'],
  },
  {
    full_name: 'Wasim Sayyed',
    phone: '8082277826',
    hub_id: 8,
    // Ops: "THIS IS BICKER (lifting loads any where)". No territory of his own,
    // so he is on all three Fort rounds rather than a fourth beat.
    beats: [
      'mumbai-fort-girgaum-tardeo',
      'mumbai-fort-kalbadevi-mazgaon',
      'mumbai-fort-colaba-ballard',
    ],
    note: 'Biker — covers anywhere in the Fort hub, not a fixed round',
  },

  // ── Delhi (hub 3) — 5 PM, except where noted ─────────────────────────────
  { full_name: 'Ranjeet Yadav', phone: '8506966667', hub_id: 3, beats: ['delhi'] },
  { full_name: 'Puneet Verma', phone: '8506966665', hub_id: 3, beats: ['delhi'] },
  {
    full_name: 'Ayan Khan',
    phone: '8506944446',
    hub_id: 3,
    beats: ['delhi'],
    // All three Delhi riders cover the same attached list, so the latest hour
    // wins for every Delhi pincode regardless. See the cutoff note in
    // shared/pickupPincodes.ts for why this is not modelled as its own beat.
    note: 'Works to 3 PM where the other two Delhi riders work to 5',
  },

  // ── Surat (hub 23) — 5 PM ────────────────────────────────────────────────
  { full_name: 'Ganjawala Sajid', phone: '7383008007', hub_id: 23, beats: ['surat'] },
  { full_name: 'Arif Bhai', phone: '9898455245', hub_id: 23, beats: ['surat'] },

  // ── Pune (hub 7) — 5 PM ──────────────────────────────────────────────────
  { full_name: 'Sohail Khan', phone: '9320599605', hub_id: 7, beats: ['pune'] },
  { full_name: 'Ayan Shaikh', phone: '7821093240', hub_id: 7, beats: ['pune'] },

  // ── Ahmedabad (hub 5) — 5 PM ─────────────────────────────────────────────
  { full_name: 'Saiyed Tahir', phone: '7043000674', hub_id: 5, beats: ['ahmedabad'] },

  // ── Jaipur (hub 9) — 5 PM ────────────────────────────────────────────────
  { full_name: 'Javed', phone: '8952889845', hub_id: 9, beats: ['jaipur'] },

  // ── Chennai (hub 10) — 5 PM ──────────────────────────────────────────────
  { full_name: 'Deva Kumar', phone: '8939455570', hub_id: 10, beats: ['chennai'] },

  // ── Hyderabad (hub 2) — 3 PM ─────────────────────────────────────────────
  {
    full_name: 'Mohammed Sohail Khan',
    phone: '7013029604',
    hub_id: 2,
    beats: ['hyderabad'],
    // Ops gave two numbers, 7013029604 / 8886878604. `itd_users.phone` is
    // unique and is what OTP login and the WhatsApp fan-out both use, so only
    // the first is stored; the second is recorded here and nowhere else.
    note: 'Second contact number on file with ops: 8886878604',
  },
];

/**
 * Riders ops have named who cannot be given an account yet.
 *
 * The Andheri hand-over of 8 Sep listed ten pickup boys against nine rounds and
 * carried no phone numbers at all. `itd_users.phone` is the unique key and is
 * what OTP sign-in and the WhatsApp fan-out both resolve, so there is nothing to
 * create an account from — a rider without a number cannot log in and cannot be
 * messaged.
 *
 * They are kept here rather than dropped because the roster is the only record
 * of who runs which round, and losing it would mean asking ops for information
 * they have already sent. Move an entry into `PICKUP_RIDERS` with its `phone`
 * and `hub_id` the moment a number arrives.
 *
 * Consequence while this list is non-empty: a job in any of these beats falls
 * through to notifying every agent in the country — see `listAgentsForPincode`.
 * For Andheri that is 59 pincodes across Mumbai's suburbs, Thane and Navi
 * Mumbai.
 */
export interface PendingRider {
  full_name: string;
  beats: readonly string[];
}

export const PENDING_RIDERS: readonly PendingRider[] = [
  { full_name: 'Shyam Kahar', beats: ['andheri-jogeshwari-borivali'] },
  { full_name: 'Kishore Shethi', beats: ['andheri-jogeshwari-kandivali'] },
  { full_name: 'Yogesh Singh', beats: ['andheri-east-powai'] },
  { full_name: 'Rafiq Shaikh', beats: ['andheri-east-powai'] },
  { full_name: 'Abrar Farooki', beats: ['andheri-west-vile-parle-juhu'] },
  { full_name: 'Sanjay Lawate', beats: ['andheri-vile-parle-bandra'] },
  { full_name: 'Shahid Khan', beats: ['andheri-west-bandra'] },
  { full_name: 'Rupesh Yadav', beats: ['andheri-chembur-ghatkopar-vashi'] },
  { full_name: 'Sameer Khan', beats: ['andheri-ghatkopar-thane-kurla'] },
  { full_name: 'Abrar Shaikh', beats: ['andheri-ghatkopar-thane-vashi'] },
];

/**
 * Beats with nobody on them.
 *
 * Not an error — a beat still makes its pincodes serviceable with no rider
 * attached, and `listAgentsForPincode` falls back to notifying everyone. It is
 * worth printing, though, because an unstaffed beat is precisely where the
 * fan-out silently stays as wide as it was before any of this existed.
 *
 * Today that is Kolkata, which has never come with a roster, and the nine
 * Andheri rounds, whose ten riders arrived without phone numbers.
 */
export function unstaffedBeats(allSlugs: readonly string[]): string[] {
  const staffed = new Set<string>();
  for (const rider of PICKUP_RIDERS) {
    for (const slug of rider.beats) staffed.add(slug);
  }
  return allSlugs.filter((slug) => !staffed.has(slug));
}
