/**
 * What a US receiver address has to be for ITD to price it.
 *
 * ITD works the freight out itself when the docket is filed, from the service,
 * the weight and where the parcel is going. An address it cannot place comes
 * back as "Freight amount is 0" and no airway bill: BOM-100305 went to ZIP
 * "1001" in "Maharashtra". So a US address is checked here, on the booking
 * form and again on the server, before it gets that far.
 */

/** The 50 states and DC, as the postal lookup names them (server/postalLookup.ts). */
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

/** Five digits, or ZIP+4. "1001" is not a ZIP; "01001" is. */
export function isUsZip(value: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(value.trim());
}

/**
 * The state's full name for a name or a two-letter code, any case; null when
 * it is not a US state. Saved addresses from before the dropdown hold either.
 */
export function usStateName(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const match = US_STATES.find((s) => s.name.toLowerCase() === v || s.code.toLowerCase() === v);
  return match ? match.name : null;
}

export const US_ZIP_ERROR = "Enter a 5-digit US ZIP code, like 10001";
export const US_STATE_ERROR = "Choose the US state";
