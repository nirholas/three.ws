import { useEffect, useRef, useState } from "react";

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const onClick = () => setOpen(true);
    window.addEventListener("sims:agent-click", onClick);
    return () => window.removeEventListener("sims:agent-click", onClick);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: {},
          history: next.slice(-10),
        }),
      });
      const data = await res.json();
      const reply = data?.reply || data?.error_description || "(no reply)";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="sims-chat">
      <div className="sims-chat-head">
        <span>Agent</span>
        <button onClick={() => setOpen(false)} aria-label="close">
          ×
        </button>
      </div>
      <div className="sims-chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="sims-chat-hint">
            Say hi to your agent. Walk around with WASD / arrows, click the
            agent to chat.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`sims-chat-msg sims-chat-${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="sims-chat-msg sims-chat-assistant">…</div>}
      </div>
      <div className="sims-chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message your agent…"
          autoFocus
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
