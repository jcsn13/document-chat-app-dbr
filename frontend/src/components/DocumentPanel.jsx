import { useState, useRef } from "react";

const FILE_ICONS = {
  pdf: "\u{1F4C4}",
  png: "\u{1F5BC}\uFE0F",
  jpg: "\u{1F5BC}\uFE0F",
  jpeg: "\u{1F5BC}\uFE0F",
  tiff: "\u{1F5BC}\uFE0F",
  tif: "\u{1F5BC}\uFE0F",
  bmp: "\u{1F5BC}\uFE0F",
  gif: "\u{1F5BC}\uFE0F",
};

function getFileIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "\u{1F4CE}";
}

export default function DocumentPanel({
  documents,
  parsedResults,
  contextDocs,
  onUpload,
  onParse,
  onAddToContext,
  onViewParsed,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setUploading(true);
      for (const file of files) {
        await onUpload(file);
      }
      setUploading(false);
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setUploading(true);
      for (const file of files) {
        await onUpload(file);
      }
      setUploading(false);
    }
    e.target.value = "";
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Documents</h2>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {documents.length} file{documents.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div
        className={`upload-area ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="upload-icon">{uploading ? "\u23F3" : "\u2B06\uFE0F"}</div>
        <p>{uploading ? "Uploading..." : "Drop files here or click to upload"}</p>
        <p className="upload-formats">PDF, PNG, JPEG, TIFF, BMP, GIF</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.bmp,.gif"
          onChange={handleFileSelect}
        />
      </div>

      <div className="document-list">
        {documents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{"\u{1F4C2}"}</div>
            <p>No documents yet</p>
            <p>Upload files to get started</p>
          </div>
        ) : (
          documents.map((doc) => {
            const parsed = parsedResults[doc.name];
            const inContext = contextDocs.includes(doc.name);
            return (
              <div
                key={doc.name}
                className={`document-item ${inContext ? "active" : ""}`}
              >
                <div className="doc-icon">{getFileIcon(doc.name)}</div>
                <div className="doc-info">
                  <div className="doc-name" title={doc.name}>
                    {doc.name}
                  </div>
                  <div className="doc-status">
                    {parsed?.loading
                      ? "Parsing..."
                      : parsed?.content
                      ? inContext
                        ? "In chat context"
                        : "Parsed"
                      : parsed?.error
                      ? "Parse error"
                      : "Ready to parse"}
                  </div>
                </div>
                <div className="doc-actions">
                  {parsed?.loading ? (
                    <div className="loading-spinner" />
                  ) : (
                    <>
                      <button
                        className="btn-icon parse-btn"
                        title={parsed?.content ? "View parsed content" : "Parse document"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (parsed?.content) {
                            onViewParsed(doc.name);
                          } else {
                            onParse(doc.name);
                          }
                        }}
                      >
                        {parsed?.content ? "\u{1F441}\uFE0F" : "\u2699\uFE0F"}
                      </button>
                      {parsed?.content && !inContext && (
                        <button
                          className="btn-icon add-btn"
                          title="Add to chat context"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToContext(doc.name);
                          }}
                        >
                          +
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
