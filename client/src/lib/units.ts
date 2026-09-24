/**
 * Pounds/inches in, kilos/centimetres out.
 *
 * The booking form and the rate screen let a customer type either, and ITD is
 * told metric. These lived in `mockData.ts`, which meant production maths sat
 * in a file named after fixtures.
 */

export const lbToKg = (lb: number): number => lb * 0.453592;
export const kgToLb = (kg: number): number => kg / 0.453592;
export const inToCm = (inches: number): number => inches * 2.54;
export const cmToIn = (cm: number): number => cm / 2.54;
