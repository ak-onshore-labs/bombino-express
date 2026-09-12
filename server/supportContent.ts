/**
 * Static guidance BIA can quote. Strings only — no ITD, no OpenAI, no DB.
 *
 * Written against how the app actually works since the final phase: India to
 * anywhere, an Order ID at booking and the AWB only once the parcel has been
 * weighed at the hub, pickup or drop-off, four ways to pay, guests welcome.
 * Anything here that stops being true is a wrong answer BIA gives with
 * confidence — change it with the feature, not after.
 */

export const guidance = {
  howToGetRates:
    "Open Rates, choose where you're shipping to and the parcel's weight, and you'll see the price for each service. Or just tell me the destination and weight and I'll quote it here. The quote is an estimate: the final price is set when we weigh the parcel at our hub.",

  howToTrack:
    "Once your parcel has a tracking number (AWB), enter it on the Track page, or ask me here. Before that, your order shows in My shipments under its Order ID (BOM-…) with its latest status. Ask me about any Order ID and I'll tell you where it is.",

  howToShip:
    "Tap Ship (Create Shipment). You don't need an account: you can verify your phone with a one-time code and book as a guest. Fill in the sender and receiver, the parcel's weight and size, choose doorstep pickup or drop-off at a Bombino counter, choose how to pay, and submit. You get an Order ID straight away; the tracking number follows once the parcel is weighed at our hub.",

  bookingSteps:
    "1) Verify your phone, or sign in. 2) Enter the sender and receiver details. 3) Add the parcel: weight, size, what's inside, and whether you want us to pack it. 4) Choose pickup (pick a date) or drop-off at a counter. 5) Choose how to pay. 6) Submit. You get an Order ID (BOM-…) right away.",

  requiredDocuments:
    "Two things. One identity document, which you give once, at signup or when you first book as a guest, and are never asked for again. Then the item details for customs: what's inside, how many, and their value. The booking form helps you with the HSN code. For anything specific to your goods, our team can advise.",

  pickupVsDropoff:
    "Doorstep pickup is available in the areas our riders cover. Tell me your pincode and I'll check. Each city has a same-day cut-off: book before it for pickup today, otherwise it's the next day. Anywhere else, you drop the parcel at a Bombino counter and show the drop-off code from your order. The Locations page lists every counter.",

  paymentMethods:
    "Four ways to pay: online when you book, to the rider at pickup, at the counter when you drop off, or pay at delivery (collected at the destination). The amount at booking is an estimate. The final amount is set when we weigh the parcel at our hub.",

  orderIdVsAwb:
    "Your Order ID (BOM-…) is issued the moment you book. The tracking number (AWB) is issued once the parcel reaches our hub and has been weighed, because the shipment is registered with its real weight and can't be changed after that. From then on you can track it on the Track page.",

  guestBooking:
    "You can book without an account: verify your phone with a one-time code, upload one identity document, and book. Your orders appear in My shipments and on your guest profile. If you later open an account with the same number, your orders move across with you.",

  guestOrAccount:
    "Sending a parcel now and then? You don't need an account: book as a guest with a one-time code on your phone. Shipping regularly, or for a business? An account keeps your orders, documents and cancellations in one place. It's Personal for yourself, or a company account (Corporate, Co-Courier, E-commerce or FBB) for a business. If you book as a guest first and open an account later with the same number, your orders move across.",

  kyc:
    "We need one identity document, given once: at signup, or with your first guest booking. It's checked automatically and you won't be asked for it again when you book. Your identity check never holds up your shipment.",

  cancellation:
    "If you have an account, you can ask to cancel from the order's page: before you drop the parcel off, or for a pickup, until the rider sets out. Our team reviews the request and you'll see their decision on the order and in Cancellations. If you booked as a guest, contact our support team to cancel.",

  refunds:
    "Refunds aren't issued automatically in the app. If a prepaid order is cancelled, or the final amount comes in lower after weighing, our team arranges the refund and gets in touch with you.",

  packaging:
    "When you book, choose 'Pack it for me' and we'll take care of it. For a pickup, the rider brings packing material; for a drop-off, we pack it at the counter. Any packaging charge is added when the parcel is weighed, not to the quote. If you pack it yourself, hand it over sealed. Fragile items travel better packed by us.",

  weightChange:
    "The price at booking is an estimate. At our hub we weigh and measure the parcel and set the final amount. If it's different, we message you, and our team gets in touch about the difference: collecting the balance, or arranging a refund if you've overpaid.",

  general:
    "I can tell you where your order is and what happens next, check pickup at your pincode, find a drop-off counter, quote rates, track an AWB, explain payments, packing and documents, and show you where anything is in the app. What do you need?",
} as const;

/**
 * What escalate_support hands the model. Nothing is raised anywhere — the
 * customer has to make contact — and the wording says so, because the model
 * otherwise tells people "I've escalated this" and they wait for a call that
 * never comes.
 */
export const escalation =
  "Nothing has been sent to the team. The customer needs to contact our support team themselves, on WhatsApp or by phone, using the buttons.";

export type GuidanceKey = keyof typeof guidance;
