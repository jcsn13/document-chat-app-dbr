import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

const DEFAULT_USER = {
  name: "",
  email: "",
  role: "",
  preferences: "",
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [user, setUser] = useState(() => {
    try {
      return { ...DEFAULT_USER, ...JSON.parse(localStorage.getItem("db-user") || "{}") };
    } catch { return { ...DEFAULT_USER }; }
  });

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const messages = activeMessages;
  const activeChat = chats.find((c) => c.id === activeChatId);

  // Fetch user identity + chat history on mount
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.name || data?.email) {
          setUser((prev) => ({ ...prev, name: data.name || prev.name, email: data.email || prev.email }));
        }
      })
      .catch(() => {});

    fetch("/api/chats")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.chats) setChats(data.chats); })
      .catch(() => {});
  }, []);

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) { setActiveMessages([]); return; }
    fetch(`/api/chats/${activeChatId}/messages`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.messages) setActiveMessages(data.messages); })
      .catch(() => {});
  }, [activeChatId]);

  // Persist user preferences locally
  useEffect(() => {
    localStorage.setItem("db-user", JSON.stringify(user));
  }, [user]);

  // Scroll on message change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const updateActiveMessages = (msgs) => {
    setActiveMessages(msgs);
  };

  const saveMessageToDb = (chatId, msg) => {
    fetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: msg.role,
        content: msg.content || "",
        agentContent: msg.agentContent || "",
        thinking: msg.thinking || "",
        attachments: msg.attachments || [],
      }),
    }).catch(() => {});
  };

  const handleNewChat = () => {
    const newChat = { id: generateId(), title: "New chat", createdAt: new Date().toISOString() };
    fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newChat),
    }).catch(() => {});
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setActiveMessages([]);
  };

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Upload failed");
    }
    return await res.json();
  };

  const handleFilesSelected = (files) => {
    const newFiles = Array.from(files).map((f) => ({
      file: f, name: f.name, status: "pending",
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFilesSelected(e.dataTransfer.files);
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const parseSSE = (text) => {
    const events = [];
    const lines = text.split("\n");
    let currentEvent = null;
    let currentData = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
      else if (line.startsWith("data: ")) currentData = line.slice(6);
      else if (line === "" && currentEvent) {
        try { events.push({ type: currentEvent, data: JSON.parse(currentData) }); }
        catch { events.push({ type: currentEvent, data: {} }); }
        currentEvent = null;
        currentData = "";
      }
    }
    return events;
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || isLoading) return;

    // Create chat if none active
    let chatId = activeChatId;
    if (!chatId) {
      const newChat = {
        id: generateId(),
        title: text?.slice(0, 40) || "Document upload",
        createdAt: new Date().toISOString(),
      };
      await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newChat),
      }).catch(() => {});
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setActiveMessages([]);
      chatId = newChat.id;
    }

    const filesToUpload = [...pendingFiles];
    const uploadedFiles = [];
    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "44px";

    // Upload files
    if (filesToUpload.length > 0) {
      setPendingFiles(filesToUpload.map((f) => ({ ...f, status: "uploading" })));
      for (const pf of filesToUpload) {
        try {
          const result = await uploadFile(pf.file);
          uploadedFiles.push(result);
        } catch (e) {
          showToast(`Failed to upload ${pf.name}: ${e.message}`, "error");
        }
      }
      setPendingFiles([]);
      if (uploadedFiles.length > 0) showToast(`Uploaded ${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""}`);
    }

    if (!text && uploadedFiles.length === 0) return;

    const displayContent = text || null;
    let agentContent = text;
    if (uploadedFiles.length > 0) {
      const filePaths = uploadedFiles.map((f) => f.path).join("\n");
      const fileInfo = uploadedFiles.length === 1
        ? `[Document available at: ${filePaths}]`
        : `[Documents available at:\n${filePaths}]`;
      agentContent = text ? `${text}\n\n${fileInfo}` : fileInfo;
    }

    // Add user context to first message if profile is set
    const currentMessages = [...activeMessages];
    if (currentMessages.length === 0 && (user.role || user.preferences)) {
      const ctx = [];
      if (user.name) ctx.push(`User name: ${user.name}`);
      if (user.role) ctx.push(`Role: ${user.role}`);
      if (user.preferences) ctx.push(`Preferences: ${user.preferences}`);
      agentContent = `[User context: ${ctx.join(". ")}]\n\n${agentContent}`;
    }

    const userMsg = {
      role: "user",
      content: displayContent || "Sent document(s)",
      agentContent,
      attachments: uploadedFiles.map((f) => f.filename),
    };

    const newMessages = [...currentMessages, userMsg];
    updateActiveMessages(newMessages);
    saveMessageToDb(chatId, userMsg);

    // Update title from first message
    if (currentMessages.length === 0 && text) {
      const title = text.slice(0, 50);
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
      fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chatId, title }),
      }).catch(() => {});
    }

    setIsLoading(true);

    const apiMessages = newMessages.map((m) => ({
      role: m.role, content: m.agentContent || m.content,
    }));

    const assistantMsg = { role: "assistant", content: "", thinking: "", thinkingDone: false };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Chat failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.trim()) continue;
          const events = parseSSE(part + "\n\n");
          for (const evt of events) {
            switch (evt.type) {
              case "thinking": assistantMsg.thinking += evt.data.delta || ""; break;
              case "thinking_done": assistantMsg.thinkingDone = true; break;
              case "text":
                if (!assistantMsg.thinkingDone && assistantMsg.thinking) assistantMsg.thinkingDone = true;
                assistantMsg.content += evt.data.delta || "";
                break;
              case "error": assistantMsg.content += `Error: ${evt.data.message || "Unknown"}`; break;
              case "done": assistantMsg.thinkingDone = true; break;
            }
            updateActiveMessages([...newMessages, { ...assistantMsg }]);
          }
        }
      }

      assistantMsg.thinkingDone = true;
      updateActiveMessages([...newMessages, { ...assistantMsg }]);
      saveMessageToDb(chatId, assistantMsg);
    } catch (e) {
      const errMsg = { role: "assistant", content: `Error: ${e.message}`, thinking: "", thinkingDone: true };
      updateActiveMessages([...newMessages, errMsg]);
      saveMessageToDb(chatId, errMsg);
    } finally {
      setIsLoading(false);
    }
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
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const getInitials = (name) => {
    if (!name) return "?";
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <svg className="logo-icon" viewBox="0 0 40 40" fill="none">
            <path d="M20 4L36 13V27L20 36L4 27V13L20 4Z" fill="#FF3621" opacity="0.9"/>
            <path d="M20 4L36 13L20 22L4 13L20 4Z" fill="#FF5F46"/>
            <path d="M20 22L36 13V27L20 36V22Z" fill="#BD2B26"/>
            <path d="M20 22L4 13V27L20 36V22Z" fill="#FF3621"/>
          </svg>
          <div>
            <h1>Databricks</h1>
            <span className="logo-sub">Supervisor Agent</span>
          </div>
        </div>

        <button className="new-chat-btn" onClick={handleNewChat}>
          + New chat
        </button>

        <div className="chat-history">
          {chats.length > 0 && <div className="history-label">Recent</div>}
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`history-item ${chat.id === activeChatId ? "active" : ""}`}
              onClick={() => setActiveChatId(chat.id)}
            >
              <span className="history-icon">{"\u{1F4AC}"}</span>
              <span className="history-text">{chat.title}</span>
            </div>
          ))}
        </div>

        <div className="user-card" onClick={() => setShowProfile(true)}>
          <div className="user-avatar">{getInitials(user.name)}</div>
          <div className="user-info">
            <div className="user-name">{user.name || "Set up profile"}</div>
            <div className="user-role">{user.role || "Click to configure"}</div>
          </div>
          <span className="user-settings-icon">{"\u2699\uFE0F"}</span>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <div className="chat-header">
          <h2>{activeChat?.title || "Supervisor Agent"}</h2>
          <span className="endpoint-badge">mas-8a39578f-endpoint</span>
        </div>

        <div className="messages">
          {messages.length === 0 && !isLoading ? (
            <div className="welcome">
              <div className="welcome-logo">
                <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                  <path d="M20 4L36 13V27L20 36L4 27V13L20 4Z" fill="#FF3621" opacity="0.9"/>
                  <path d="M20 4L36 13L20 22L4 13L20 4Z" fill="#FF5F46"/>
                  <path d="M20 22L36 13V27L20 36V22Z" fill="#BD2B26"/>
                  <path d="M20 22L4 13V27L20 36V22Z" fill="#FF3621"/>
                </svg>
              </div>
              <h2>{user.name ? `Hi, ${user.name.split(" ")[0]}!` : "Document Chat"}</h2>
              <p>
                Chat with the supervisor agent. Attach documents (PDF, DOC, DOCX,
                PPT, PPTX, PNG, JPG) using the + button or drag &amp; drop.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.role}`}>
                  {msg.attachments?.length > 0 && (
                    <div className="message-attachments">
                      {msg.attachments.map((name, j) => (
                        <span key={j} className="attachment-tag">
                          <span className="att-icon">{"\u{1F4CE}"}</span>
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.role === "assistant" && msg.thinking ? (
                    <ThinkingBlock
                      thinking={msg.thinking}
                      isDone={msg.thinkingDone}
                      isStreaming={!msg.thinkingDone && !msg.content}
                    />
                  ) : null}
                  <div className="message-bubble">
                    {msg.role === "assistant" ? (
                      msg.content ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      ) : !msg.thinking ? (
                        <span className="cursor-blink" />
                      ) : null
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}
              {isLoading && !messages.some((m, i) => i === messages.length - 1 && m.role === "assistant") && (
                <div className="typing"><span /><span /><span /></div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <div
            className={`input-box ${dragOver ? "drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {pendingFiles.length > 0 && (
              <div className="pending-files">
                {pendingFiles.map((pf, i) => (
                  <div key={i} className="pending-file">
                    {"\u{1F4CE}"} {pf.name}
                    {pf.status === "uploading" ? (
                      <span className="uploading-text">uploading...</span>
                    ) : (
                      <button onClick={() => removePendingFile(i)}>{"\u00D7"}</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="input-row">
              <button
                className="attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
              >
                +
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    if (e.target.files.length) handleFilesSelected(e.target.files);
                    e.target.value = "";
                  }}
                />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={dragOver ? "Drop files here..." : "How can I help you today?"}
                rows={1}
              />
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={(!input.trim() && pendingFiles.length === 0) || isLoading}
              >
                {"\u2191"}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Profile Modal */}
      {showProfile && (
        <ProfileModal
          user={user}
          onSave={(u) => { setUser(u); setShowProfile(false); showToast("Profile saved"); }}
          onClose={() => setShowProfile(false)}
          getInitials={getInitials}
        />
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function ThinkingBlock({ thinking, isDone, isStreaming }) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (isDone) {
      const timer = setTimeout(() => setExpanded(false), 800);
      return () => clearTimeout(timer);
    }
  }, [isDone]);

  return (
    <div className={`thinking-block ${isDone ? "done" : "active"}`}>
      <button className="thinking-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className={`thinking-chevron ${expanded ? "open" : ""}`}>{"\u25B8"}</span>
        <span className="thinking-label">
          {!isDone ? (<><span className="thinking-spinner" />Thinking...</>) : "Thought process"}
        </span>
      </button>
      {expanded && (
        <div className="thinking-content">
          <ReactMarkdown>{thinking}</ReactMarkdown>
          {isStreaming && <span className="cursor-blink" />}
        </div>
      )}
    </div>
  );
}

function ProfileModal({ user, onSave, onClose, getInitials }) {
  const [form, setForm] = useState({ ...user });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>User Profile</h3>
          <button className="modal-close" onClick={onClose}>{"\u2715"}</button>
        </div>
        <div className="modal-body">
          <div className="profile-avatar-section">
            <div className="profile-avatar-large">{getInitials(form.name)}</div>
            <div className="profile-name-display">
              <div className="pname">{form.name || "Your Name"}</div>
              <div className="pemail">{form.email || "your.email@company.com"}</div>
            </div>
          </div>

          <div className="form-group">
            <label>Full Name</label>
            <input
              value={form.name}
              readOnly
              className="readonly"
            />
            <span className="form-hint">Auto-detected from Databricks login</span>
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              value={form.email}
              readOnly
              className="readonly"
            />
            <span className="form-hint">Auto-detected from Databricks login</span>
          </div>

          <div className="form-group">
            <label>Role / Title</label>
            <input
              value={form.role}
              onChange={(e) => handleChange("role", e.target.value)}
              placeholder="Solutions Architect, Data Engineer, etc."
            />
          </div>

          <div className="form-group">
            <label>Preferences &amp; Context</label>
            <textarea
              value={form.preferences}
              onChange={(e) => handleChange("preferences", e.target.value)}
              placeholder="Any context you'd like the agent to know about you. E.g., preferred response style, domain expertise, current projects..."
              rows={3}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>Save Profile</button>
        </div>
      </div>
    </div>
  );
}
