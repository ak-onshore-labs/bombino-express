/**
 * The chips above BIA's typing box: questions for the screen the customer is
 * on, so the first tap is already about where they're stuck. Each is a
 * question BIA can answer there. A chip that needs a part of BIA that isn't
 * switched on (BIA_MODULES) is left out, so a chip never leads nowhere.
 *
 * The customer's own live orders are added in front on Home, Help and Orders
 * by the server (server/supportOrders.ts §suggestionsFor), which knows them.
 */

import type { BiaModule } from "./biaModules.js";
import type { BiaScreen } from "./biaScreen.js";

interface Chip {
  text: string;
  /** Left out unless this module is on. */
  needs?: BiaModule;
}

const GENERAL: readonly Chip[] = [
  { text: "How do I book a shipment?" },
  { text: "Get shipping rates" },
  { text: "Is pickup available at my pincode?" },
  { text: "Track a shipment" },
  { text: "Can I book without an account?" },
];

/** Per booking-form step (shared/biaScreen.ts §BIA_SCREEN_STEPS create). */
const CREATE_STEPS: Record<string, readonly Chip[]> = {
  sender: [
    { text: "Pickup or drop-off: which should I choose?" },
    { text: "Is pickup available at my pincode?" },
    { text: "Which ID document can I use?" },
    { text: "What do I fill in on this step?", needs: "booking" },
  ],
  receiver: [
    { text: "What do I fill in on this step?", needs: "booking" },
    { text: "Can I send my item to this country?", needs: "booking" },
    { text: "How long does delivery take?" },
  ],
  package: [
    { text: "What is the declared value?", needs: "booking" },
    { text: "Should Bombino pack it for me?" },
    { text: "Why might the final price change?" },
  ],
  invoice: [
    { text: "Which product type do I pick?", needs: "booking" },
    { text: "What HS code should I use?", needs: "booking" },
    { text: "What is CSB V?", needs: "booking" },
  ],
  payment: [
    { text: "Which payment method should I choose?" },
    { text: "When is the final amount set?" },
    { text: "Can I pay when the rider comes?" },
  ],
};

function chipsFor(screen: BiaScreen | null): readonly Chip[] {
  if (!screen) return GENERAL;
  switch (screen.surface) {
    case "order": {
      const o = screen.orderNo;
      if (!o) return GENERAL;
      return [
        { text: `What's the latest on ${o}?` },
        { text: `Where's the pickup code for ${o}?` },
        { text: `Can I cancel ${o}?` },
        { text: `How do I pay for ${o}?` },
        { text: "When will it be delivered?" },
      ];
    }
    case "orders":
      return [
        { text: "How do I cancel an order?" },
        { text: "Why don't I have a tracking number yet?" },
        { text: "How do I export my shipments?" },
        { text: "Where is my parcel?" },
      ];
    case "track":
      return [
        { text: "Why don't I have a tracking number yet?" },
        { text: "Where can I download my shipping label?" },
        { text: "How long does delivery take?" },
        { text: "What does my tracking status mean?" },
      ];
    case "rates":
      return [
        { text: "Why is the price an estimate?" },
        { text: "What is the fuel surcharge?" },
        { text: "Is pickup available at my pincode?" },
        { text: "How do I book a shipment?" },
      ];
    case "create": {
      const step = screen.step ? CREATE_STEPS[screen.step] : undefined;
      return (
        step ?? [
          { text: "How do I book a shipment?" },
          { text: "Pickup or drop-off: which should I choose?" },
          { text: "Can I book without an account?" },
          { text: "What documents do I need?" },
        ]
      );
    }
    case "signup":
      return [
        { text: "Which account do I need?", needs: "onboarding" },
        { text: "Where does my signup stand?", needs: "onboarding" },
        { text: "What documents will I need?" },
        { text: "What is a GSTIN?", needs: "onboarding" },
        { text: "Can I book without an account?" },
      ];
    case "documents":
      return [
        { text: "Which of my documents are missing?", needs: "documents" },
        { text: "How do I replace my ID document?" },
        { text: "How do I change my mobile number?" },
        { text: "How do I turn off BIA reminders?" },
      ];
    case "guest_profile":
      return [
        { text: "Where are my orders?" },
        { text: "Should I open an account?" },
        { text: "How do I save my details for next time?" },
        { text: "How do I turn off BIA reminders?" },
      ];
    default:
      return GENERAL;
  }
}

/** The chips for this screen, with the ones needing a switched-off module left out. */
export function screenChips(screen: BiaScreen | null, modules: readonly BiaModule[]): string[] {
  return chipsFor(screen)
    .filter((c) => !c.needs || modules.includes(c.needs))
    .map((c) => c.text);
}

/** Screens where the customer's own live orders lead the chips. */
export function screenWantsOrderChips(screen: BiaScreen | null): boolean {
  return !screen || screen.surface === "home" || screen.surface === "help" || screen.surface === "orders";
}
