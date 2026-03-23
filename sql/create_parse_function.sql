-- Creates a UC function that parses document binary content using AI_PARSE_DOCUMENT.
-- Returns extracted text in markdown format.
--
-- Usage (the agent composes this query):
--   SELECT agentbricks_catalog.document_ai_demo.parse_document(content) as parsed_text
--   FROM read_files('/Volumes/agentbricks_catalog/document_ai_demo/uploads/report.pdf', format => 'binaryFile')
--
-- Supported formats: PDF, DOC, DOCX, PPT, PPTX, PNG, JPG, JPEG

CREATE OR REPLACE FUNCTION agentbricks_catalog.document_ai_demo.parse_document(
  file_content BINARY COMMENT 'Binary content of a document file. Use read_files() to provide this.'
)
RETURNS STRING
LANGUAGE SQL
COMMENT 'Parses document content using AI_PARSE_DOCUMENT. Returns extracted text in markdown. Call with: SELECT parse_document(content) FROM read_files(path, format => "binaryFile")'
RETURN CAST(ai_parse_document(file_content, map('outputFormat', 'MARKDOWN')) AS STRING);
