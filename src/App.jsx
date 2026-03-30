import { useState, useRef, useEffect, useCallback } from "react";
import { OpenRouter } from "@openrouter/sdk";

const INTENT_CONFIG = {
    RESUME: { label: "Resume Help", color: "#f59e0b", icon: "📄" },
    JOB_SEARCH: { label: "Job Search", color: "#10b981", icon: "🔍" },
    INTERVIEW: { label: "Interview Prep", color: "#6366f1", icon: "🎯" },
    CORPORATE: { label: "Corporate World", color: "#ec4899", icon: "🏢" },
    TECHNICAL: { label: "Tech Career", color: "#3b82f6", icon: "💻" },
    GENERAL: { label: "Career Advice", color: "#8b5cf6", icon: "🧠" },
};

const SUGGESTIONS = [
    "How do I optimize my resume for ATS systems?",
    "What's the best way to negotiate a salary offer?",
    "How do I prepare for a system design interview?",
    "Should I join a startup or a big tech company?",
    "How do I cold email a hiring manager effectively?",
    "What skills do I need to break into data science?",
];

const openrouter = new OpenRouter({
    apiKey: import.meta.env.VITE_OPENROUTER_API_KEY
});

const SYSTEM_PROMPT = `You are CareerMind, a highly intelligent career advisory agent.
Your ONLY output format is to FIRST provide your detected intent on a single line starting with: "INTENT: [INTENT_NAME]", followed immediately by your detailed advisory response on the next line.
Allowed INTENT_NAMEs: RESUME, JOB_SEARCH, INTERVIEW, CORPORATE, TECHNICAL, GENERAL.
Provide brilliant, actionable, hyper-specific career guidance. Never break character.`;

// ── Agent pipeline indicator ──────────────────────────────────────────────────
const AgentStep = ({ phase, status, detail }) => {
    const colors = { idle: "#374151", active: "#f59e0b", done: "#10b981" };
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: status === "idle" ? 0.35 : 1, transition: "all 0.3s ease" }}>
            <div style={{
                width: "7px", height: "7px", borderRadius: "50%",
                background: colors[status],
                boxShadow: status === "active" ? `0 0 8px ${colors[status]}` : "none",
                animation: status === "active" ? "pulse 1s infinite" : "none",
            }} />
            <span style={{ fontSize: "10px", fontFamily: "'IBM Plex Mono',monospace", color: colors[status], letterSpacing: "0.05em" }}>
                {phase}
            </span>
            {detail && status === "done" && (
                <span style={{
                    fontSize: "9px", fontFamily: "'IBM Plex Mono',monospace",
                    color: "#6b7280", background: "#1f2937", padding: "1px 6px",
                    borderRadius: "3px", border: "1px solid #374151",
                }}>{detail}</span>
            )}
        </div>
    );
};

// ── Rich text renderer ────────────────────────────────────────────────────────
const RichText = ({ text }) => {
    const lines = text.split("\n");
    return (
        <div>
            {lines.map((line, i) => {
                if (!line && i < lines.length - 1) return <div key={i} style={{ height: "7px" }} />;

                // ### heading
                if (line.startsWith("### "))
                    return <p key={i} style={{ color: "#93c5fd", fontWeight: 600, fontSize: "13px", margin: "10px 0 4px", letterSpacing: "0.02em" }}>{line.slice(4)}</p>;

                // ## heading
                if (line.startsWith("## "))
                    return <p key={i} style={{ color: "#f59e0b", fontWeight: 700, fontSize: "14px", fontFamily: "'Playfair Display',serif", margin: "12px 0 5px" }}>{line.slice(3)}</p>;

                // bullet
                if (line.match(/^[-•*] /))
                    return (
                        <div key={i} style={{ display: "flex", gap: "8px", margin: "3px 0", paddingLeft: "2px" }}>
                            <span style={{ color: "#f59e0b", flexShrink: 0, marginTop: "1px" }}>▸</span>
                            <span style={{ lineHeight: 1.65 }}>{inlineMarkdown(line.slice(2))}</span>
                        </div>
                    );

                // numbered
                const numMatch = line.match(/^(\d+)\. /);
                if (numMatch)
                    return (
                        <div key={i} style={{ display: "flex", gap: "8px", margin: "3px 0", paddingLeft: "2px" }}>
                            <span style={{ color: "#6366f1", flexShrink: 0, fontFamily: "monospace", fontSize: "11px", marginTop: "2px" }}>{numMatch[1]}.</span>
                            <span style={{ lineHeight: 1.65 }}>{inlineMarkdown(line.slice(numMatch[0].length))}</span>
                        </div>
                    );

                // bold-only line
                if (line.startsWith("**") && line.endsWith("**") && line.length > 4)
                    return <p key={i} style={{ color: "#e5e7eb", fontWeight: 600, margin: "8px 0 3px" }}>{line.slice(2, -2)}</p>;

                return <p key={i} style={{ margin: "2px 0", lineHeight: 1.7 }}>{inlineMarkdown(line)}</p>;
            })}
        </div>
    );
};

// Inline bold/code/italic
function inlineMarkdown(text) {
    const parts = [];
    const re = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push(text.slice(last, m.index));
        if (m[2]) parts.push(<strong key={m.index} style={{ color: "#e5e7eb" }}>{m[2]}</strong>);
        else if (m[3]) parts.push(<code key={m.index} style={{ background: "#1f2937", color: "#fbbf24", padding: "1px 5px", borderRadius: "3px", fontFamily: "monospace", fontSize: "12px" }}>{m[3]}</code>);
        else if (m[4]) parts.push(<em key={m.index} style={{ color: "#d1d5db" }}>{m[4]}</em>);
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length ? parts : text;
}

// ── Cursor blink for streaming ────────────────────────────────────────────────
const Cursor = () => (
    <span style={{
        display: "inline-block", width: "2px", height: "14px",
        background: "#f59e0b", marginLeft: "2px", verticalAlign: "middle",
        animation: "cursorBlink 0.8s step-end infinite",
    }} />
);

// ── Message bubble ────────────────────────────────────────────────────────────
const MessageBubble = ({ msg, isStreaming }) => {
    const isUser = msg.role === "user";
    const intent = msg.intent ? INTENT_CONFIG[msg.intent] : null;
    const displayText = isUser ? msg.content : (msg.content || "");

    return (
        <div style={{
            display: "flex", flexDirection: isUser ? "row-reverse" : "row",
            gap: "10px", marginBottom: "18px", alignItems: "flex-start",
            animation: "fadeInUp 0.25s ease",
        }}>
            {!isUser && (
                <div style={{
                    width: "32px", height: "32px", borderRadius: "8px", flexShrink: 0,
                    background: "linear-gradient(135deg,#f59e0b,#d97706)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "14px", boxShadow: "0 4px 12px rgba(245,158,11,0.3)",
                }}>🧠</div>
            )}
            <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", gap: "5px", alignItems: isUser ? "flex-end" : "flex-start" }}>
                {!isUser && intent && (
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: "5px",
                        background: `${intent.color}15`, border: `1px solid ${intent.color}40`,
                        borderRadius: "12px", padding: "2px 10px", fontSize: "10px",
                        color: intent.color, fontFamily: "'IBM Plex Mono',monospace",
                    }}>
                        {intent.icon} {intent.label}
                    </div>
                )}
                <div style={{
                    background: isUser ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : "#111827",
                    border: isUser ? "none" : "1px solid #1f2937",
                    borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
                    padding: "12px 16px",
                    color: "#d1d5db", fontSize: "13.5px", lineHeight: 1.7,
                    boxShadow: isUser ? "0 4px 20px rgba(29,78,216,0.25)" : "0 2px 12px rgba(0,0,0,0.4)",
                    minWidth: isStreaming && !isUser && !displayText ? "60px" : undefined,
                }}>
                    {isUser
                        ? displayText
                        : displayText
                            ? <><RichText text={displayText} />{isStreaming && <Cursor />}</>
                            : <span style={{ color: "#4b5563", fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px" }}>
                                <Cursor />
                            </span>
                    }
                </div>
            </div>
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────
export default function CareerAgent() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [agentPhase, setAgentPhase] = useState({ perceive: "idle", decide: "idle", act: "idle" });
    const [detectedIntent, setDetectedIntent] = useState(null);

    const messagesEndRef = useRef(null);
    const abortRef = useRef(null);
    const historyRef = useRef([]);   // tracks messages without re-render lag

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isStreaming]);

    const sendMessage = useCallback(async (text) => {
        const userMsg = (text || input).trim();
        if (!userMsg || isStreaming) return;
        setInput("");

        // Add user message
        const userEntry = { role: "user", content: userMsg };
        historyRef.current = [...historyRef.current, userEntry];
        setMessages(prev => [...prev, userEntry]);

        // ── Phase 1: PERCEIVE ──────────────────────────────────────
        setAgentPhase({ perceive: "active", decide: "idle", act: "idle" });
        await delay(500);

        // ── Phase 2: DECIDE ────────────────────────────────────────
        setAgentPhase({ perceive: "done", decide: "active", act: "idle" });
        await delay(400);

        // ── Phase 3: ACT ───────────────────────────────────────────
        setAgentPhase({ perceive: "done", decide: "done", act: "active" });
        setIsStreaming(true);

        // Placeholder bubble while streaming
        const assistantEntry = { role: "assistant", content: "", intent: null };
        setMessages(prev => [...prev, assistantEntry]);

        try {
            // Validate and log messages
            const validatedMessages = historyRef.current.map(m => {
                if (!m.role || !m.content) {
                    console.error("Invalid message format:", m);
                    throw new Error("Invalid message format. Each message must have 'role' and 'content'.");
                }
                return { role: m.role, content: m.content };
            });

            console.log("Sending messages:", validatedMessages);

            // Use standard fetch to avoid SDK validation issues
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:5173", // Site URL for OpenRouter ranking
                    "X-OpenRouter-Title": "CareerMind Agent"
                },
                body: JSON.stringify({
                    model: "google/gemma-3-4b-it:free",
                    messages: [
                        { 
                          role: "user", 
                          content: `${SYSTEM_PROMPT}\n\nUser: ${validatedMessages[0].content}` 
                        },
                        ...validatedMessages.slice(1).map(m => ({
                            role: m.role,
                            content: m.content
                        }))
                    ],
                    stream: true
                })
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n").filter(line => line.trim().startsWith("data: "));

                for (const line of lines) {
                    const dataStr = line.replace("data: ", "").trim();
                    if (dataStr === "[DONE]") {
                        setAgentPhase({ perceive: "done", decide: "done", act: "done" });
                        continue;
                    }

                    try {
                        const json = JSON.parse(dataStr);
                        const content = json.choices[0]?.delta?.content;
                        if (content) {
                            fullResponse += content;
                            setMessages(prev => {
                                const next = [...prev];
                                const lastMsg = next[next.length - 1];
                                
                                let cleanContent = fullResponse;
                                let intent = lastMsg.intent;
                                if (fullResponse.startsWith("INTENT: ")) {
                                    const lines = fullResponse.split("\n");
                                    const intentMatch = lines[0].match(/INTENT: (RESUME|JOB_SEARCH|INTERVIEW|CORPORATE|TECHNICAL|GENERAL)/);
                                    if (intentMatch) {
                                        intent = intentMatch[1];
                                        setDetectedIntent(intent);
                                        cleanContent = lines.slice(1).join("\n").trim();
                                    }
                                }

                                next[next.length - 1] = { role: "assistant", content: cleanContent, intent: intent };
                                return next;
                            });
                        }

                        if (json.usage) {
                            console.log("\nReasoning tokens:", json.usage.reasoningTokens);
                        }
                    } catch (err) {
                        console.warn("Error parsing chunk:", err);
                    }
                }
            }

            setAgentPhase({ perceive: "done", decide: "done", act: "done" });

        } catch (err) {
            console.error("Agent error:", err);
            setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                    role: "assistant",
                    content: `⚠️ Something went wrong: ${err.message}.`,
                    intent: "GENERAL",
                };
                return next;
            });
        } finally {
            setIsStreaming(false);
            setTimeout(() => setAgentPhase({ perceive: "idle", decide: "idle", act: "idle" }), 2500);
        }
    }, [input, isStreaming]);

    const handleKey = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };

    return (
        <div style={{
            minHeight: "100vh", background: "#030712",
            fontFamily: "'Inter',sans-serif",
            display: "flex", flexDirection: "column",
            position: "relative", overflow: "hidden",
        }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#0a0f1a}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes cursorBlink{0%,100%{opacity:1}50%{opacity:0}}
        .suggestion-btn:hover{background:#1f2937!important;border-color:#f59e0b!important;color:#f59e0b!important}
        .send-btn:hover:not(:disabled){background:#d97706!important}
        textarea:focus{outline:none!important;border-color:#374151!important}
      `}</style>

            {/* bg grid */}
            <div style={{
                position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
                backgroundImage: `linear-gradient(rgba(245,158,11,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(245,158,11,.03) 1px,transparent 1px)`,
                backgroundSize: "40px 40px",
            }} />

            {/* ── HEADER ───────────────────────────────────────────────── */}
            <div style={{
                position: "relative", zIndex: 10,
                borderBottom: "1px solid #111827",
                padding: "14px 24px",
                background: "rgba(3,7,18,.95)",
                backdropFilter: "blur(10px)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: "10px",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{
                        width: "38px", height: "38px", borderRadius: "10px",
                        background: "linear-gradient(135deg,#f59e0b,#92400e)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "18px", boxShadow: "0 4px 16px rgba(245,158,11,.35)",
                    }}>🧠</div>
                    <div>
                        <div style={{ fontFamily: "'Playfair Display',serif", color: "#f9fafb", fontSize: "17px", fontWeight: 700 }}>
                            CareerMind
                        </div>
                        <div style={{ fontSize: "10px", color: "#6b7280", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: ".06em" }}>
                            CAREER INTELLIGENCE AGENT
                        </div>
                    </div>
                </div>

                {/* pipeline */}
                <div style={{
                    background: "#0a0f1a", border: "1px solid #1f2937",
                    borderRadius: "8px", padding: "8px 14px",
                    display: "flex", flexDirection: "column", gap: "4px",
                }}>
                    <div style={{ fontSize: "9px", color: "#4b5563", fontFamily: "'IBM Plex Mono',monospace", marginBottom: "2px", letterSpacing: ".08em" }}>
                        AGENT PIPELINE
                    </div>
                    <AgentStep phase="01 · PERCEIVE" status={agentPhase.perceive} />
                    <AgentStep phase="02 · DECIDE" status={agentPhase.decide} />
                    <AgentStep phase="03 · ACT" status={agentPhase.act} detail={detectedIntent} />
                </div>
            </div>

            {/* ── MESSAGES ─────────────────────────────────────────────── */}
            <div style={{
                flex: 1, overflowY: "auto", padding: "24px",
                position: "relative", zIndex: 5,
                maxWidth: "820px", width: "100%", margin: "0 auto",
            }}>
                {messages.length === 0 ? (
                    <div style={{ animation: "fadeInUp 0.5s ease" }}>
                        <div style={{ textAlign: "center", padding: "36px 0 28px" }}>
                            <div style={{ fontSize: "48px", marginBottom: "14px" }}>🎯</div>
                            <h1 style={{
                                fontFamily: "'Playfair Display',serif",
                                color: "#f9fafb", fontSize: "24px", fontWeight: 700, marginBottom: "8px",
                            }}>Your Career Intelligence Agent</h1>
                            <p style={{ color: "#6b7280", fontSize: "13.5px", maxWidth: "400px", margin: "0 auto", lineHeight: 1.7 }}>
                                Ask me anything about resumes, job searching, interviews, salary negotiation, or the corporate & tech world.
                            </p>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "22px" }}>
                            {SUGGESTIONS.map((s, i) => (
                                <button key={i} className="suggestion-btn" onClick={() => sendMessage(s)}
                                    style={{
                                        background: "#0a0f1a", border: "1px solid #1f2937",
                                        borderRadius: "10px", padding: "12px 14px",
                                        color: "#9ca3af", fontSize: "12.5px", cursor: "pointer",
                                        textAlign: "left", transition: "all .2s", lineHeight: 1.5,
                                    }}>
                                    <span style={{ color: "#f59e0b", marginRight: "6px" }}>→</span>{s}
                                </button>
                            ))}
                        </div>

                        <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                            {Object.values(INTENT_CONFIG).map(({ label, color, icon }) => (
                                <div key={label} style={{
                                    background: `${color}12`, border: `1px solid ${color}30`,
                                    borderRadius: "20px", padding: "4px 12px",
                                    fontSize: "11px", color, fontFamily: "'IBM Plex Mono',monospace",
                                }}>
                                    {icon} {label}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((msg, i) => (
                        <MessageBubble
                            key={i}
                            msg={msg}
                            isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                        />
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ── INPUT ────────────────────────────────────────────────── */}
            <div style={{
                position: "relative", zIndex: 10,
                borderTop: "1px solid #111827",
                padding: "14px 24px",
                background: "rgba(3,7,18,.97)",
                backdropFilter: "blur(10px)",
            }}>
                <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex", gap: "10px", alignItems: "flex-end" }}>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Ask about resumes, interviews, salary negotiation, tech careers..."
                        rows={1}
                        disabled={isStreaming}
                        style={{
                            flex: 1, background: "#0a0f1a",
                            border: "1px solid #1f2937", borderRadius: "12px",
                            padding: "12px 16px", color: "#e5e7eb",
                            fontSize: "13.5px", resize: "none", lineHeight: 1.6,
                            fontFamily: "'Inter',sans-serif", transition: "border-color .2s",
                            opacity: isStreaming ? 0.6 : 1,
                        }}
                    />
                    <button
                        className="send-btn"
                        onClick={() => sendMessage()}
                        disabled={isStreaming || !input.trim()}
                        style={{
                            width: "44px", height: "44px", borderRadius: "12px",
                            background: isStreaming || !input.trim() ? "#1f2937" : "#f59e0b",
                            border: "none",
                            cursor: isStreaming || !input.trim() ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "18px", transition: "all .2s",
                            color: isStreaming || !input.trim() ? "#4b5563" : "#000",
                            flexShrink: 0,
                        }}>
                        {isStreaming ? "⋯" : "↑"}
                    </button>
                </div>
                <div style={{
                    maxWidth: "820px", margin: "7px auto 0",
                    fontSize: "10px", color: "#374151", textAlign: "center",
                    fontFamily: "'IBM Plex Mono',monospace",
                }}>
                    made by- Garv Chandnani
                </div>
            </div>
        </div>
    );
}

const delay = ms => new Promise(r => setTimeout(r, ms));