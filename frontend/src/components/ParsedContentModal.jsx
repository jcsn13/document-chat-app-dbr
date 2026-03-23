import ReactMarkdown from "react-markdown";

export default function ParsedContentModal({
  filename,
  parsed,
  onClose,
  onAddToContext,
  isInContext,
}) {
  if (!parsed) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{filename} - Parsed Content</h3>
          <div className="modal-actions">
            {!isInContext && parsed.content && (
              <button className="btn btn-primary" onClick={onAddToContext}>
                + Add to Chat
              </button>
            )}
            {isInContext && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--success)",
                  padding: "8px 12px",
                }}
              >
                {"\u2713"} In chat context
              </span>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              {"\u2715"}
            </button>
          </div>
        </div>
        <div className="modal-body">
          {parsed.loading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div className="loading-spinner" />
              <p style={{ marginTop: 12, color: "var(--text-muted)" }}>
                Parsing document with AI...
              </p>
            </div>
          ) : parsed.error ? (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                color: "var(--error)",
              }}
            >
              <p>Failed to parse document</p>
              <p style={{ fontSize: 12, marginTop: 8 }}>{parsed.error}</p>
            </div>
          ) : (
            <ReactMarkdown>{parsed.content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
