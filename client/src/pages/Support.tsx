import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Send,
  Loader2,
  Plus,
  Phone,
} from "lucide-react";
import { useLocation } from "wouter";
import { BiaBackground } from "@/components/ui/bia-background";
import { BiaOrb } from "@/components/ui/bia-orb";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { parseAssistantMessage } from "@/lib/supportMessage";
import { useAppStore } from "@/lib/store";
import { useSupportContacts } from "@/hooks/useSupportContacts";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Track my shipment 📦",
  "Get shipping rates ✈️",
  "Help with my order 🙋",
] as const;

const GENERIC_ERROR =
  "Something went wrong. Please try again or contact support from the app menu.";

function parseSessionMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.content !== "string") continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export default function Support() {
  const [, setLocation] = useLocation();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const logout = useAppStore((s) => s.logout);
  const { waHref, telHref } = useSupportContacts();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSentMessagesRef = useRef<ChatMessage[]>([]);
  const sessionRedirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

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

  useEffect(() => {
    if (!isLoggedIn) {
      setSessionId(null);
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const sendMessages = async (nextMessages: ChatMessage[]) => {
    lastSentMessagesRef.current = nextMessages;
    if (sessionRedirectTimeoutRef.current !== null) {
      clearTimeout(sessionRedirectTimeoutRef.current);
      sessionRedirectTimeoutRef.current = null;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/support/chat", {
        messages: nextMessages,
        sessionId: isLoggedIn ? sessionId : null,
      });
      const data = (await res.json()) as {
        message?: string;
        sessionId?: string | null;
      };
      const text =
        typeof data?.message === "string"
          ? data.message
          : GENERIC_ERROR;
      if (typeof data.sessionId === "string") {
        setSessionId(data.sessionId);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: text },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (msg.includes("401")) {
        setError("Your session expired. Please log in again.");
        sessionRedirectTimeoutRef.current = setTimeout(() => {
          sessionRedirectTimeoutRef.current = null;
          logout();
          setLocation("/login");
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

  const sendUserText = (text: string) => {
    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    void sendMessages(nextMessages);
  };

  const handleNewChat = async () => {
    if (!isLoggedIn || loading) return;
    setError(null);
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

  return (
    <div
      className="flex h-viewport flex-col overflow-hidden safe-top safe-bottom relative"
      data-testid="screen-support"
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
          <button
            type="button"
            onClick={() => setLocation("/home")}
            className="p-2 -ml-2 rounded-lg text-white/90 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-lg text-white tracking-tight">
              BIA
            </h1>
            <p className="text-[10px] text-white/40 tracking-wide uppercase mt-0.5">
              Bombino Intelligence Assistant
            </p>
            <p className="text-xs text-white/50">
              Tracking, rates, and shipping help
            </p>
          </div>
          {isLoggedIn && (
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
              <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
                <div className="w-[200px] h-[200px] mb-2">
                  <BiaOrb />
                </div>
                <h2 className="text-xl font-semibold text-white mb-1">
                  Ask BIA
                </h2>
                <p className="text-xs text-white/40 mb-3">
                  Bombino Intelligence Assistant
                </p>
                <p className="text-sm text-white/60 max-w-[260px] leading-relaxed mb-10">
                  Track shipments, get rates, or resolve shipping questions faster.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-4 mb-6 px-2">
                {SUGGESTIONS.map((s) => (
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
              {!isLoggedIn && (
                <div
                  className="mx-4 mb-4 rounded-xl p-3 flex items-center justify-between gap-3"
                  style={{
                    background: "rgba(20,86,124,0.08)",
                    border: "1px solid rgba(20,86,124,0.2)",
                  }}
                >
                  <p className="text-xs text-white/60">
                    Log in for personalised support and shipment tracking
                  </p>
                  <button
                    type="button"
                    onClick={() => setLocation("/login")}
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
                        i === messages.length - 1 && "animate-bia-message-in"
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
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex justify-start",
                      i === messages.length - 1 && "animate-bia-message-in"
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
                      {parsed.cta === "create_shipment" &&
                        (isLoggedIn ? (
                          <button
                            type="button"
                            onClick={() => setLocation("/create")}
                            className="w-full rounded-xl py-3 px-4 text-sm font-semibold text-white flex items-center justify-center gap-2"
                            style={{ background: "#14567C" }}
                          >
                            🚀 Create Shipment Now
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setLocation("/login")}
                            className="w-full rounded-xl py-2 px-4 text-sm text-white/70 underline text-center"
                          >
                            Log in to create a shipment
                          </button>
                        ))}
                      {parsed.cta === "contact_us" && (
                        <div className="flex gap-2">
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-sm font-medium text-white"
                            style={{ background: "#25D366" }}
                          >
                            WhatsApp Us
                          </a>
                          <a
                            href={telHref}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-sm font-medium border border-amber-400/40 text-amber-100/90 bg-amber-500/10"
                          >
                            <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            Call Us
                          </a>
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
