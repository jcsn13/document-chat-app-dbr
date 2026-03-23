-- Databricks notebook source
-- Setup Unity Catalog resources for the Document Chat app

-- COMMAND ----------

CREATE SCHEMA IF NOT EXISTS agentbricks_catalog.document_ai_demo;

-- COMMAND ----------

CREATE VOLUME IF NOT EXISTS agentbricks_catalog.document_ai_demo.uploads;

-- COMMAND ----------

CREATE OR REPLACE FUNCTION agentbricks_catalog.document_ai_demo.parse_document(
  file_content BINARY COMMENT 'Binary content of a document file. Use read_files() to provide this.'
)
RETURNS STRING
LANGUAGE SQL
COMMENT 'Parses document content using AI_PARSE_DOCUMENT. Returns extracted text in markdown. Call with: SELECT parse_document(content) FROM read_files(path, format => "binaryFile")'
RETURN CAST(ai_parse_document(file_content, map('outputFormat', 'MARKDOWN')) AS STRING);

-- COMMAND ----------

-- Test the function (optional, requires a file in the volume)
-- SELECT agentbricks_catalog.document_ai_demo.parse_document(content) as parsed_text
-- FROM read_files('/Volumes/agentbricks_catalog/document_ai_demo/uploads/sample.pdf', format => 'binaryFile')
-- LIMIT 1;
