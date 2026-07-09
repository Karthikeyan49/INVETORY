import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send, Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatContext } from "@/contexts/ChatContext";
import { chatApi } from "@/lib/api/chat";

interface Msg { role: "user" | "assistant"; content: string; }

const SESSION_KEY  = "eco_chat_session";
const POS_KEY      = "eco_chat_pos";

const GREETING: Msg = {
  role: "assistant",
  content: "Hi! I'm the Inventory Management System assistant. Ask me anything about our products, services, or policies.",
};

/** Read saved position or fall back to bottom-right */
function savedPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  // Default: bottom-right (we'll pin it at render time using window size)
  return { x: -1, y: -1 };
}

export function ChatWidget() {
  const [open, setOpen]           = useState(false);
  const [input, setInput]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [messages, setMessages]   = useState<Msg[]>([GREETING]);
  const [sessionId, setSessionId] = useState<string>(
    () => localStorage.getItem(SESSION_KEY) ?? ""
  );
  const { current } = useChatContext();
  const scrollRef   = useRef<HTMLDivElement>(null);

  // ─── Drag state ─────────────────────────────────────────────────────────────
  const [pos, setPos]         = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const dragRef               = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false });
  const containerRef          = useRef<HTMLDivElement>(null);

  // Initialise position once the component mounts so we have window dimensions
  useEffect(() => {
    const saved = savedPos();
    if (saved.x !== -1) {
      setPos(saved);
    } else {
      setPos({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
    }
  }, []);

  // Clamp position so widget never goes off-screen on resize
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(p.x, window.innerWidth  - 64),
        y: Math.min(p.y, window.innerHeight - 64),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const savePos = (x: number, y: number) => {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  };

  // ─── Pointer drag handlers ───────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    // Only drag on the button / header — not on form inputs or buttons inside panel
    if ((e.target as HTMLElement).closest("button:not([data-drag-handle]),input,textarea,a")) return;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;

    // Panel size: ~400×600 open, 56×56 closed
    const W = open ? Math.min(400, window.innerWidth  - 32) : 56;
    const H = open ? Math.min(600, window.innerHeight - 48) : 56;

    const newX = Math.max(0, Math.min(window.innerWidth  - W, dragRef.current.origX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - H, dragRef.current.origY + dy));
    setPos({ x: newX, y: newY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    savePos(pos.x, pos.y);
    // If barely moved → treat as a click (open/close)
    if (!dragRef.current.moved && !open) setOpen(true);
  };

  // ─── Chat logic ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || messages.length > 1) return;
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) return;
    chatApi.history(sid).then((history) => {
      if (history.length > 0) setMessages([GREETING, ...history]);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res = await chatApi.send(text, sessionId || undefined);
      if (res.session_id && res.session_id !== sessionId) {
        setSessionId(res.session_id);
        localStorage.setItem(SESSION_KEY, res.session_id);
      }
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't reach the server. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  // Don't render until position is initialised (avoids flash at 0,0)
  if (pos.x === -1) return null;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999, userSelect: "none", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Launcher button (closed state) */}
      {!open && (
        <button
          data-drag-handle
          aria-label="Open Inventory Management System assistant"
          className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center cursor-grab active:cursor-grabbing"
        >
          <MessageCircle className="h-6 w-6 pointer-events-none" />
        </button>
      )}

      {/* Chat panel (open state) */}
      {open && (
        <div className="w-[min(400px,calc(100vw-2rem))] h-[min(600px,calc(100vh-3rem))] bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header — drag handle */}
          <div
            data-drag-handle
            className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground cursor-grab active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-2 pointer-events-none">
              <Sparkles className="h-5 w-5" />
              <div>
                <p className="font-semibold text-sm leading-tight">Ask Inventory Management System</p>
                <p className="text-[11px] text-primary-foreground/80 leading-tight">
                  {current?.page ? `Context: ${current.page}` : "Powered by Groq AI"}
                </p>
              </div>
            </div>
            <Button
              size="icon" variant="ghost"
              className="h-8 w-8 text-primary-foreground hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 cursor-default">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={send} className="border-t p-3 flex gap-2 cursor-default">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about products, pricing, services…"
              disabled={busy}
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
