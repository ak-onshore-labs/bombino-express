import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { BiaScreen } from "@shared/biaScreen";
import { BiaChat } from "@/components/bia/BiaChat";
import { navigateInApp } from "@/lib/biaNavigate";

/**
 * /help — BIA as a full page. The chat itself is BiaChat, which the BIA sheet
 * uses too; this page only turns `?order=BOM-…` (opened from an order screen)
 * into the screen context and a first question about that order.
 */
export default function Support(): React.JSX.Element {
  const [, setLocation] = useLocation();
  const search = useSearch();

  // Read once: the parameter is dropped after the question is sent, so a
  // reload does not ask again, but the conversation stays about that order.
  const [orderNo] = useState<string | null>(() => {
    const raw = new URLSearchParams(search).get("order")?.trim().toUpperCase() ?? "";
    return /^BOM-\d{6,9}$/.test(raw) ? raw : null;
  });
  const [screen] = useState<BiaScreen>(() =>
    orderNo ? { surface: "order", orderNo } : { surface: "help" }
  );

  return (
    <BiaChat
      variant="page"
      screen={screen}
      seed={orderNo ? `What's the latest on my order ${orderNo}?` : null}
      seedKey={1}
      onSeedSent={() => setLocation("/help", { replace: true })}
      onClose={() => setLocation("/home")}
      onNavigate={(to) => navigateInApp(setLocation, to)}
    />
  );
}
