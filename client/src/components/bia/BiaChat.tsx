import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  X,
  Send,
  Loader2,
  Plus,
  Phone,
  Package,
  ChevronRight,
  MapPin,
  ListOrdered,
  Radar,
  XCircle,
  UserRound,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { BiaBackground } from "@/components/ui/bia-background";
import { BiaOrb } from "@/components/ui/bia-orb";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { parseAssistantMessage, type SupportCta } from "@/lib/supportMessage";
import { BiaCards } from "@/components/bia/BiaCards";
import { parseBiaCards, type BiaCard } from "@shared/biaCards";
import type { BiaScreen } from "@shared/biaScreen";
import { useAppStore } from "@/lib/store";
import { useGuestProfile } from "@/hooks/useGuestProfile";

/**
 * One turn. `cards` ride along on BIA's replies for this conversation only;
 * the server stores text, so a transcript restored from an account keeps its
 * buttons (they are in the text) but not its cards.
 */
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  cards?: BiaCard[];
  /** Names the reply for a thumbs up or down; absent on restored ones. */
  turnId?: string;
  rating?: 1 | -1;
};

/** Shown until the server's own chips arrive, and if they never do. */
const DEFAULT_SUGGESTIONS = [
  "Show my orders",
  "Get shipping rates",
  "Is pickup available at my pincode?",
] as const;

const GENERIC_ERROR =
  "Something went wrong. Please try again or contact support from the app menu.";

/**
 * Where a conversation survives a reload when there is no account to keep it
 * on the server. Per tab, on purpose: a guest's chat is about their orders, and
 * a shared device should not hand it to whoever opens the app next.
 */
const LOCAL_HISTORY_KEY = "bia-chat";

function parseSessionMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.content !== "string") continue;
    const cards = m.role === "assistant" ? parseBiaCards(m.cards) : [];
    const message: ChatMessage = { role: m.role, content: m.content };
    if (cards.length > 0) message.cards = cards;
    if (m.role === "assistant" && typeof m.turnId === "string" && /^[0-9a-f-]{36}$/i.test(m.turnId)) {
      message.turnId = m.turnId;
      if (m.rating === 1 || m.rating === -1) message.rating = m.rating;
    }
    out.push(message);
  }
  return out;
}

function readLocalHistory(): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(LOCAL_HISTORY_KEY);
    return raw ? parseSessionMessages(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeLocalHistory(messages: ChatMessage[]): void {
  try {
    if (messages.length === 0) {
      window.sessionStorage.removeItem(LOCAL_HISTORY_KEY);
    } else {
      window.sessionStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(messages));
    }
  } catch {
    /* storage blocked — the chat still works, it just won't survive a reload */
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export interface BiaChatProps {
  /** `page` fills /help; `sheet` sits in the BIA sheet over another screen. */
  variant: "page" | "sheet";
  /** Where the chat was opened from. Sent with every turn. */
  screen: BiaScreen;
  /** A first message to send for the customer once history has loaded. */
  seed?: string | null;
  /** Changes with each new request, so the same seed text can be sent again. */
  seedKey?: number;
  /** Called once the seed has been sent. */
  onSeedSent?: () => void;
  /** Back (page) or close (sheet). */
  onClose: () => void;
  /** Where a card, a button or the sign-in prompt leads. */
  onNavigate: (to: string) => void;
}

/**
 * BIA's chat: the transcript, cards and buttons, and the input. One
 * conversation per customer — an account's is kept on the server, anyone
 * else's in this tab — so the /help page and the sheet show the same one.
 */
export function BiaChat({
  variant,
  screen,
  seed = null,
  seedKey = 0,
  onSeedSent,
  onClose,
  onNavigate,
}: BiaChatProps): React.JSX.Element {
  const isSheet = variant === "sheet";
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const logout = useAppStore((s) => s.logout);
  const { data: guestProfile } = useGuestProfile({ enabled: !isLoggedIn });
  const isGuest = !isLoggedIn && !!guestProfile;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);
  const [starterChips, setStarterChips] = useState<string[]>([...DEFAULT_SUGGESTIONS]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSentMessagesRef = useRef<ChatMessage[]>([]);
  const seedSentRef = useRef<number | null>(null);
  const sessionRedirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Sent with every turn; the server keeps only known values (shared/biaScreen.ts).
  const screenRef = useRef<BiaScreen>(screen);
  screenRef.current = screen;

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    if (messages.length === 0) return;
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      if (sessionRedirectTimeoutRef.current !== null) {
        clearTimeout(sessionRedirectTimeoutRef.current);
      }
    };
  }, []);

  // Without an account the transcript lives in this tab only.
  useEffect(() => {
    if (isLoggedIn || !restoreDone) return;
    writeLocalHistory(messages);
  }, [messages, isLoggedIn, restoreDone]);

  useEffect(() => {
    if (!isLoggedIn) {
      setSessionId(null);
      const local = readLocalHistory();
      if (local.length > 0) setMessages(local);
      setRestoreDone(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/support/session", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          sessionId?: string | null;
          messages?: unknown;
        };
        if (cancelled) return;
        const restored = parseSessionMessages(data.messages);
        if (restored.length > 0) {
          setMessages(restored);
          if (typeof data.sessionId === "string") {
            setSessionId(data.sessionId);
          }
          setRestoredNotice(true);
          window.setTimeout(() => {
            if (!cancelled) setRestoredNotice(false);
          }, 3000);
        } else if (typeof data.sessionId === "string") {
          setSessionId(data.sessionId);
        }
      } catch {
        /* ignore restore errors */
      } finally {
        if (!cancelled) setRestoreDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // Starter chips, led by the caller's own live orders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/support/suggestions", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { chips?: unknown };
        if (!cancelled && isStringArray(data.chips) && data.chips.length > 0) {
          setStarterChips(data.chips.slice(0, 4));
        }
      } catch {
        /* keep the defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, isGuest]);

  const sendMessages = async (nextMessages: ChatMessage[]) => {
    lastSentMessagesRef.current = nextMessages;
    if (sessionRedirectTimeoutRef.current !== null) {
      clearTimeout(sessionRedirectTimeoutRef.current);
      sessionRedirectTimeoutRef.current = null;
    }
    setLoading(true);
    setError(null);
    setQuickReplies([]);
    try {
      const res = await apiRequest("POST", "/api/support/chat", {
        // Cards are ours to draw, not the model's to read: only text goes back.
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        sessionId: isLoggedIn ? sessionId : null,
        screen: screenRef.current,
      });
      const data = (await res.json()) as {
        message?: string;
        sessionId?: string | null;
        suggestions?: unknown;
        cards?: unknown;
        turnId?: unknown;
      };
      const text =
        typeof data?.message === "string"
          ? data.message
          : GENERIC_ERROR;
      if (typeof data.sessionId === "string") {
        setSessionId(data.sessionId);
      }
      const cards = parseBiaCards(data.cards);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: text,
          ...(cards.length > 0 ? { cards } : {}),
          ...(typeof data.turnId === "string" ? { turnId: data.turnId } : {}),
        },
      ]);
      setQuickReplies(isStringArray(data.suggestions) ? data.suggestions.slice(0, 3) : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (msg.includes("401")) {
        setError("Your session expired. Please log in again.");
        sessionRedirectTimeoutRef.current = setTimeout(() => {
          sessionRedirectTimeoutRef.current = null;
          logout();
          onNavigate("/login");
        }, 2000);
      } else if (
        lower.includes("fetch") ||
        lower.includes("network") ||
        lower.includes("failed to fetch")
      ) {
        setError(
          "Connection lost. Please check your internet and try again."
        );
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // A thumb is kept on the message straight away; the server hears about it
  // in the background, and a failure there changes nothing on screen.
  const rate = (turnId: string, rating: 1 | -1) => {
    setMessages((prev) => prev.map((m) => (m.turnId === turnId ? { ...m, rating } : m)));
    void apiRequest("POST", "/api/support/feedback", { turnId, rating }).catch(() => undefined);
  };

  const sendUserText = (text: string) => {
    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    void sendMessages(nextMessages);
  };

  // A seed is sent once per request, after any history has loaded, so it
  // lands at the end of the conversation rather than before it.
  useEffect(() => {
    if (!restoreDone || !seed || loading || seedSentRef.current === seedKey) return;
    seedSentRef.current = seedKey;
    sendUserText(seed);
    onSeedSent?.();
  }, [restoreDone, seed, seedKey, loading]);

  const handleNewChat = async () => {
    if (loading) return;
    setError(null);
    setQuickReplies([]);
    if (!isLoggedIn) {
      setMessages([]);
      setInput("");
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/support/new-session", {});
      const data = (await res.json()) as { sessionId?: string };
      if (typeof data.sessionId === "string") {
        setSessionId(data.sessionId);
      }
      setMessages([]);
      setInput("");
      setRestoredNotice(false);
    } catch {
      setError(GENERIC_ERROR);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    sendUserText(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = messages.length === 0 && !loading;
  const lastIndex = messages.length - 1;

  return (
    <div
      className={cn(
        "relative isolate flex flex-col overflow-hidden",
        isSheet ? "h-full" : "h-viewport safe-top safe-bottom"
      )}
      data-testid={isSheet ? "bia-sheet-chat" : "screen-support"}
    >
      <style>{`
        @keyframes biaShimmer {
          0% {
            background-position: 200% center;
          }
          100% {
            background-position: -200% center;
          }
        }
      `}</style>
      <BiaBackground />

      {/* Minimal top: back + BIA + tagline */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2 max-w-md mx-auto w-full">
        <div className="flex items-center gap-2">
          {!isSheet && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 -ml-2 rounded-lg text-white/90 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-lg text-white tracking-tight">
              BIA
            </h1>
            <p className="text-[10px] text-white/40 tracking-wide uppercase mt-0.5">
              Bombino Intelligence Assistant
            </p>
            <p className="text-xs text-white/50">
              Your orders, pickups, rates and tracking
            </p>
          </div>
          {messages.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleNewChat()}
              disabled={loading}
              className="shrink-0 h-8 px-2 text-xs text-[#FBAD1F]/80 hover:text-white hover:bg-white/10 border border-[#FBAD1F]/30"
              aria-label="New chat"
            >
              <Plus className="w-3.5 h-3.5 mr-1" aria-hidden />
              New chat
            </Button>
          )}
          {isSheet && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FBAD1F]/60"
              aria-label="Close BIA"
              data-testid="button-close-bia"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        {restoredNotice && (
          <p
            className="text-[11px] text-emerald-400/90 mt-2 text-center"
            role="status"
          >
            Conversation restored
          </p>
        )}
      </div>

      {/* Scrollable content: empty state or messages — transparent so dark AI background stays visible */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 max-w-md mx-auto w-full bg-transparent"
      >
        <div className="py-4 pb-40 bg-transparent">
          {isEmpty ? (
            <>
              {/* AI empty-state centerpiece */}
              <div
                className={cn(
                  "flex flex-col items-center justify-center text-center",
                  isSheet ? "min-h-[24vh]" : "min-h-[40vh]"
                )}
              >
                <div className={isSheet ? "w-[120px] h-[120px] mb-2" : "w-[200px] h-[200px] mb-2"}>
                  <BiaOrb />
                </div>
                <h2 className="text-xl font-semibold text-white mb-1">
                  Ask BIA
                </h2>
                <p className="text-xs text-white/40 mb-3">
                  Bombino Intelligence Assistant
                </p>
                <p className={cn("text-sm text-white/60 max-w-[260px] leading-relaxed", isSheet ? "mb-4" : "mb-10")}>
                  Where your order is, what happens next, pickup at your pincode, rates and tracking.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-4 mb-6 px-2">
                {starterChips.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={loading}
                    onClick={() => sendUserText(s)}
                    className="rounded-full border border-[#FBAD1F]/30 px-4 py-2 text-sm text-white/70 bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {s}
                  </button>
                ))}
              </div>
              {!isLoggedIn && !isGuest && (
                <div
                  className="mx-4 mb-4 rounded-xl p-3 flex items-center justify-between gap-3"
                  style={{
                    background: "rgba(20,86,124,0.08)",
                    border: "1px solid rgba(20,86,124,0.2)",
                  }}
                >
                  <p className="text-xs text-white/60">
                    Log in to ask about your own orders
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate("/login")}
                    className="text-xs font-medium shrink-0 text-[#FBAD1F]"
                  >
                    Log in →
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => {
                const isUser = msg.role === "user";
                if (isUser) {
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex justify-end",
                        i === lastIndex && "animate-bia-message-in"
                      )}
                    >
                      <div
                        className="max-w-[85%] rounded-2xl px-4 py-3 text-sm rounded-br-md"
                        style={{
                          background: "rgba(251,173,31,0.15)",
                          border: "1px solid rgba(251,173,31,0.4)",
                        }}
                      >
                        <p className="whitespace-pre-wrap break-words text-white/95">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  );
                }

                const parsed = parseAssistantMessage(msg.content);
                const cards = msg.cards ?? [];
                // A card already opens its order or shipment; no second button for it.
                const carded = new Set(
                  cards.flatMap((c) => (c.kind === "order" ? [c.orderNo, c.awb] : [])).filter(Boolean)
                );
                const ctas = parsed.ctas.filter(
                  (c) =>
                    !(c.kind === "view_order" && carded.has(c.orderNo)) &&
                    !(c.kind === "track" && carded.has(c.awb))
                );
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex justify-start",
                      i === lastIndex && "animate-bia-message-in"
                    )}
                  >
                    <div className="flex flex-col gap-2 max-w-[85%]">
                      <div
                        className="rounded-2xl px-4 py-3 text-sm rounded-bl-md backdrop-blur-[8px]"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        <p className="whitespace-pre-wrap break-words text-white/95">
                          {parsed.text}
                        </p>
                      </div>
                      <BiaCards cards={cards} onNavigate={onNavigate} />
                      {ctas.length > 0 && (
                        <CtaButtons ctas={ctas} onNavigate={onNavigate} />
                      )}
                      {msg.turnId && (
                        <Thumbs
                          rating={msg.rating}
                          onRate={(rating) => msg.turnId && rate(msg.turnId, rating)}
                        />
                      )}
                      {i === lastIndex && !loading && quickReplies.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {quickReplies.map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => sendUserText(q)}
                              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 bg-white/[0.03] hover:bg-white/[0.08] transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-start animate-bia-message-in">
                  <div
                    className="rounded-2xl rounded-bl-md px-4 py-3 text-sm flex flex-col items-start backdrop-blur-[8px]"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <span className="flex gap-1 items-center">
                      <span className="bia-typing-dot w-1.5 h-1.5 rounded-full bg-white/80" />
                      <span className="bia-typing-dot w-1.5 h-1.5 rounded-full bg-white/80" />
                      <span className="bia-typing-dot w-1.5 h-1.5 rounded-full bg-white/80" />
                    </span>
                    <p
                      className="text-xs mt-2 font-medium"
                      style={{
                        background:
                          "linear-gradient(90deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.7) 40%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.7) 60%, rgba(255,255,255,0.2) 100%)",
                        backgroundSize: "200% auto",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                        animation: "biaShimmer 2s linear infinite",
                      }}
                    >
                      BIA is thinking...
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="shrink-0 px-4 py-2 max-w-md mx-auto w-full absolute bottom-28 left-0 right-0">
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm px-3 py-2 flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (lastSentMessagesRef.current.length > 0) {
                  void sendMessages(lastSentMessagesRef.current);
                } else {
                  setError(null);
                }
              }}
              className="shrink-0 border-white/20 text-white hover:bg-white/10"
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Floating input dock + disclaimer */}
      <div className="flex-shrink-0 px-4 pb-4 pt-4 max-w-md mx-auto w-full">
        <div
          className={cn(
            "rounded-2xl p-2 flex gap-2 items-end",
            "bg-white/[0.06] border border-white/[0.06]",
            "shadow-[0_8px_32px_rgba(0,0,0,.35),0_0_0_1px_rgba(255,255,255,.03)]"
          )}
        >
          <Textarea
            placeholder="Ask BIA..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={1}
            className={cn(
              "min-h-[44px] max-h-24 resize-none py-2.5 px-3 flex-1",
              "bg-transparent border-0 text-white placeholder:text-white/40",
              "focus-visible:ring-0 focus-visible:ring-offset-0"
            )}
            aria-label="Message"
          />
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className={cn(
              "shrink-0 h-10 w-10 rounded-full text-white border-0 transition-all duration-200",
              "bg-[#FBAD1F] hover:bg-[#ECB954] active:scale-95",
              "shadow-[0_0_20px_rgba(251,173,31,0.35),inset_0_0_0_1px_rgba(255,255,255,.08)]"
            )}
            aria-label="Send"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-white/40 text-center mt-2 px-2">
          BIA may make mistakes. Please verify important shipment details.
        </p>
      </div>
    </div>
  );
}

// ── Buttons under a reply ──────────────────────────────────────────────────

const PILL =
  "inline-flex items-center gap-1.5 rounded-xl py-2 px-3 text-xs font-medium border border-white/15 text-white/85 bg-white/[0.05] hover:bg-white/[0.1] transition-colors";

function CtaButtons({
  ctas,
  onNavigate,
}: {
  ctas: SupportCta[];
  onNavigate: (to: string) => void;
}): React.JSX.Element {
  const orders = ctas.filter((c): c is Extract<SupportCta, { kind: "view_order" }> => c.kind === "view_order");
  const create = ctas.some((c) => c.kind === "create_shipment");
  const contact = ctas.some((c) => c.kind === "contact_us");
  const others = ctas.filter(
    (c) => c.kind !== "view_order" && c.kind !== "create_shipment" && c.kind !== "contact_us"
  );

  return (
    <div className="flex flex-col gap-2">
      {orders.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {orders.map((o) => (
            <button
              key={o.orderNo}
              type="button"
              onClick={() => onNavigate(`/order/${encodeURIComponent(o.orderNo)}`)}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left border border-[#FBAD1F]/25 bg-[#FBAD1F]/[0.06] hover:bg-[#FBAD1F]/[0.12] transition-colors"
            >
              <Package className="w-4 h-4 shrink-0 text-[#FBAD1F]" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-white tabular-nums">{o.orderNo}</span>
                <span className="block text-[11px] text-white/50">Open order</span>
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-white/40" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((c) => {
            switch (c.kind) {
              case "track":
                return (
                  <button key={`track-${c.awb}`} type="button" className={PILL} onClick={() => onNavigate(`/shipment/${encodeURIComponent(c.awb)}`)}>
                    <Radar className="w-3.5 h-3.5" aria-hidden />
                    Track {c.awb}
                  </button>
                );
              case "locations":
                return (
                  <button
                    key={`loc-${c.state ?? ""}`}
                    type="button"
                    className={PILL}
                    onClick={() => onNavigate(c.state ? `/locations?near=${encodeURIComponent(c.state)}` : "/locations")}
                  >
                    <MapPin className="w-3.5 h-3.5" aria-hidden />
                    Drop-off counters
                  </button>
                );
              case "my_orders":
                return (
                  <button key="my-orders" type="button" className={PILL} onClick={() => onNavigate("/orders")}>
                    <ListOrdered className="w-3.5 h-3.5" aria-hidden />
                    My shipments
                  </button>
                );
              case "cancellations":
                return (
                  <button key="cancellations" type="button" className={PILL} onClick={() => onNavigate("/orders?tab=cancellations")}>
                    <XCircle className="w-3.5 h-3.5" aria-hidden />
                    Cancellations
                  </button>
                );
              case "guest_profile":
                return (
                  <button key="guest-profile" type="button" className={PILL} onClick={() => onNavigate("/guest-profile")}>
                    <UserRound className="w-3.5 h-3.5" aria-hidden />
                    My profile
                  </button>
                );
              default:
                return null;
            }
          })}
        </div>
      )}

      {create && (
        <button
          type="button"
          onClick={() => onNavigate("/create")}
          className="w-full rounded-xl py-3 px-4 text-sm font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: "#14567C" }}
        >
          🚀 Book a shipment
        </button>
      )}

      {contact && (
        <div className="flex gap-2">
          <a
            href="https://api.whatsapp.com/send?phone=917045999553"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-sm font-medium text-white"
            style={{ background: "#25D366" }}
          >
            WhatsApp Us
          </a>
          <a
            href="tel:+912266400000"
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-sm font-medium border border-amber-400/40 text-amber-100/90 bg-amber-500/10"
          >
            <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden />
            Call Us
          </a>
        </div>
      )}
    </div>
  );
}

// ── Was this helpful? ──────────────────────────────────────────────────────

function Thumbs({
  rating,
  onRate,
}: {
  rating?: 1 | -1;
  onRate: (rating: 1 | -1) => void;
}): React.JSX.Element {
  const button = (value: 1 | -1, label: string, Icon: typeof ThumbsUp) => {
    const chosen = rating === value;
    return (
      <button
        type="button"
        onClick={() => onRate(value)}
        aria-label={label}
        aria-pressed={chosen}
        className={cn(
          "rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FBAD1F]/60",
          chosen ? "text-[#FBAD1F]" : "text-white/35 hover:text-white/70"
        )}
        data-testid={value === 1 ? "button-bia-helpful" : "button-bia-not-helpful"}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden fill={chosen ? "currentColor" : "none"} />
      </button>
    );
  };
  return (
    <div className="flex items-center gap-0.5 -ml-1">
      {button(1, "Helpful", ThumbsUp)}
      {button(-1, "Not helpful", ThumbsDown)}
      {rating !== undefined && <span className="ml-1 text-[11px] text-white/40">Thanks for telling us</span>}
    </div>
  );
}
