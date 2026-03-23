import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export default function ChatPanel({
  messages,
  contextDocs,
  isLoading,
  onSend,
  onRemoveContext,
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
    onSend(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = "44px";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  return (
    <div className="main-content">
      <div className="chat-header">
        <h2>Supervisor Agent Chat</h2>
        <span className="endpoint-badge">mas-8a39578f-endpoint</span>
      </div>

      <div className="messages-area">
        {messages.length === 0 && !isLoading ? (
          <div className="welcome-screen">
            <div className="welcome-icon">{"\u{1F916}"}</div>
            <h3>Document Chat Assistant</h3>
            <p>
              Upload documents on the left, parse them with AI, then chat with
              the supervisor agent. Parsed documents can be added to the chat
              context for reference.
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role}`}>
                {msg.role === "assistant" ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            ))}
            {isLoading && (
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {contextDocs.length > 0 && (
          <div className="context-chips">
            {contextDocs.map((doc) => (
              <div key={doc} className="context-chip">
                {"\u{1F4CE}"} {doc}
                <button onClick={() => onRemoveContext(doc)}>{"\u00D7"}</button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={
              contextDocs.length > 0
                ? "Ask about your documents..."
                : "Send a message to the supervisor agent..."
            }
            rows={1}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            {"\u2191"}
          </button>
        </div>
      </div>
    </div>
  );
}
