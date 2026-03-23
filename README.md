# Document Chat App

A full-stack Databricks App that lets users upload documents and chat with an AgentBricks Multi-Agent System (MAS) supervisor agent. Documents are parsed with `ai_parse_document` and the agent answers questions grounded in the document content.

**Stack:** React (Vite) + FastAPI + Lakebase (Postgres) + AgentBricks MAS + Unity Catalog

---

## Architecture

```
Browser  -->  Databricks App (FastAPI)  -->  AgentBricks MAS Endpoint
                   |                              |
                   v                              v
              Lakebase (Postgres)         UC Function: parse_document()
              (chat history)              (ai_parse_document via SQL Warehouse)
                                                  |
                                                  v
                                          UC Volume (uploaded files)
```

---

## Prerequisites

- Databricks workspace with **Unity Catalog** enabled
- Databricks CLI installed and authenticated (`databricks auth login`)
- **AgentBricks** enabled in the workspace
- A **SQL Warehouse** (Serverless or Pro)
- Node.js 18+ (for frontend builds)
- Python 3.9+ (for local testing)

---

## Configuration Variables

All values that must be customized for your environment are listed below. Search-and-replace these across the relevant files.

### `databricks.yml`

| Variable | Value | Description |
|----------|-------|-------------|
| `workspace.host` | `<YOUR_WORKSPACE_URL>` | Your Databricks workspace URL |

### `app/app.yaml`

| Variable | Value | Description |
|----------|-------|-------------|
| `SUPERVISOR_ENDPOINT` | `<YOUR_MAS_ENDPOINT>` | Name of the MAS serving endpoint (see [Create the MAS Endpoint](#step-1-create-the-mas-endpoint)) |
| `WAREHOUSE_ID` | `<YOUR_WAREHOUSE_ID>` | SQL Warehouse ID used by the agent for `parse_document` |
| `VOLUME_PATH` | `/Volumes/<CATALOG>/<SCHEMA>/uploads` | UC Volume path for uploaded documents |
| `LAKEBASE_HOST` | `<YOUR_LAKEBASE_HOST>` | Lakebase endpoint hostname (output of setup notebook) |
| `LAKEBASE_ENDPOINT` | `projects/<LAKEBASE_PROJECT>/branches/production/endpoints/primary` | Lakebase endpoint full name |
| `serving_endpoint` (resources) | `<YOUR_MAS_ENDPOINT>` | Must match `SUPERVISOR_ENDPOINT` |
| `sql_warehouse` (resources) | `<YOUR_WAREHOUSE_ID>` | Must match `WAREHOUSE_ID` |

### `notebooks/setup_all_resources.py`

| Variable | Value | Description |
|----------|-------|-------------|
| `APP_NAME` | `<YOUR_APP_NAME>` | Databricks App name (must match `databricks.yml`) |
| `CATALOG` | `<YOUR_CATALOG>` | Unity Catalog name |
| `SCHEMA` | `<YOUR_SCHEMA>` | Schema within the catalog |
| `VOLUME` | `<YOUR_VOLUME>` | Volume name for document storage |
| `LAKEBASE_PROJECT` | `<YOUR_LAKEBASE_PROJECT>` | Lakebase project name |
| `SERVING_ENDPOINT` | `<YOUR_MAS_ENDPOINT>` | Must match `app.yaml` |
| `WAREHOUSE_ID` | `<YOUR_WAREHOUSE_ID>` | Must match `app.yaml` |

### `frontend/src/App.jsx` (line 372)

| Variable | Value | Description |
|----------|-------|-------------|
| Endpoint badge text | `<YOUR_MAS_ENDPOINT>` | Cosmetic — displayed in the chat header UI |

---

## Setup Guide

### Step 1: Create the MAS Endpoint

The app requires an AgentBricks **Multi-Agent System (MAS)** supervisor endpoint. Create it in the Databricks workspace UI:

1. Navigate to **Serving** in the left sidebar
2. Click **Create serving endpoint** > **Build a supervisor agent (AgentBricks)**
3. Configure the agent:

   **Basic Info:**
   - **Name:** `document-agent` (any name — this generates the endpoint name, e.g. `mas-xxxxxxxx-endpoint`)
   - **Description:** `Agent the answer based on a document information`

   **Configure Agents:**
   - Click **+ Add** and select the UC function `<YOUR_CATALOG>.<YOUR_SCHEMA>.parse_document`
   - Set the tool name to `function-parse-document`
   - Set **Describe the content** to:
     ```
     Parses document content using AI_PARSE_DOCUMENT. Returns extracted
     text in markdown. Call with: SELECT parse_document(content) FROM
     read_files(path, format => "binaryFile")
     ```

   **Optional > Instructions:**

   Expand the **Optional** section and paste these agent instructions:

   ```
   You are a supervisor agent that answers questions about a single document.

   Tool behavior
   - You have a UC function tool that takes a document's file_content and returns
     the full document as MARKDOWN:
     CAST(ai_parse_document(file_content, map('outputFormat', 'MARKDOWN')) AS STRING)
   - The tool output is a plain markdown string representing the entire document
     content. It does NOT return JSON or explicit metadata.

   Your job
   1. When the user's question requires information from the document, FIRST call
      the UC function tool to retrieve the markdown representation of the document.
   2. Read and reason over the returned markdown to answer the question.
   3. Produce a final answer in the following structure, in markdown:

      **Answer**
      <short, helpful answer in your own words, directly addressing the user's question>

      **Details**
      - Optional short bullets with key supporting points or explanations.
      - Only include this section if it adds real value.

      **References**
      - Treat the UC function's markdown as the source document.
      - Infer a human-readable title as follows:
        - If there is a top-level heading (a line starting with `# `), use that
          text as the title (without the `#`).
        - Otherwise, use the first non-empty line of the document, truncated to
          a reasonable length.
      - Output references as a markdown list like:
        - `1. <Inferred title> (internal document parsed via ai_parse_document)`
      - If you used only this single document, still include it as item 1.
      - Do NOT invent external URLs; you do not know the real URL.

   Formatting & style
   - Always respond in markdown.
   - Start with a direct, concise **Answer** (like Gemini/Claude/ChatGPT).
   - Keep **Details** brief.
   - Always include a **References** section, even if there is only one item.
   - Do not show raw tool calls or low-level function names; keep the answer
     user-friendly.
   ```

4. Click **Create**. Wait for the endpoint to reach **Ready** status.
5. Copy the generated endpoint name (e.g. `mas-8a39578f-endpoint`) and update it in:
   - `app/app.yaml` (`SUPERVISOR_ENDPOINT` env var and `serving_endpoint` resource)
   - `notebooks/setup_all_resources.py` (`SERVING_ENDPOINT`)
   - `frontend/src/App.jsx` line 372 (cosmetic badge)

### Step 2: Update Configuration

1. Clone this repository
2. Update `databricks.yml` with your workspace host
3. Update `app/app.yaml` with your endpoint, warehouse, and volume values
4. Update `notebooks/setup_all_resources.py` with matching values

> **Note:** Leave `LAKEBASE_HOST` and `LAKEBASE_ENDPOINT` empty for now — the setup notebook will output the correct values.

### Step 3: Deploy the Bundle (First Time)

```bash
# Deploy the bundle — this creates the Databricks App and setup job
databricks bundle deploy
```

### Step 4: Run the Setup Notebook

The setup notebook provisions all resources and permissions automatically. Run it in your Databricks workspace:

1. Navigate to **Workflows** > find **[document-chat] Setup All Resources**
2. Click **Run now**
3. The notebook will:
   - Look up the app's service principal
   - Create the Unity Catalog schema, volume, and `parse_document` function
   - Grant UC permissions (USE CATALOG, USE SCHEMA, READ/WRITE VOLUME, EXECUTE FUNCTION) to the app service principal
   - Grant `CAN_QUERY` on the serving endpoint and `CAN_USE` on the SQL warehouse to the app service principal
   - Create the Lakebase project and production branch
   - Create the database schema (`chats`, `messages`, `documents` tables)
   - Grant all Postgres permissions to the app service principal
4. At the end, the notebook prints the Lakebase connection info:
   ```
   Lakebase Host:     ep-xxxxx.database.us-east-1.cloud.databricks.com
   Lakebase Endpoint: projects/document-chat-db/branches/production/endpoints/primary
   ```
5. **Copy these values** into `app/app.yaml` (`LAKEBASE_HOST` and `LAKEBASE_ENDPOINT`)

### Step 5: Build the Frontend

```bash
cd frontend
npm install
npm run build    # outputs to ../app/static/
cd ..
```

### Step 6: Deploy and Launch

```bash
# Upload updated files and deploy the app
databricks bundle deploy
databricks apps deploy document-chat \
  --source-code-path /Workspace/Users/<your-email>/.bundle/document-chat/dev/files/app
```

The app URL will be printed in the output, or find it with:

```bash
databricks apps get document-chat --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])"
```

---

## Permissions Checklist

The setup notebook handles these automatically, but if you need to verify manually:

| Resource | Permission | Granted To |
|----------|-----------|------------|
| Unity Catalog (catalog) | `USE CATALOG` | App service principal |
| Unity Catalog (schema) | `USE SCHEMA` | App service principal |
| UC Volume | `READ VOLUME`, `WRITE VOLUME` | App service principal |
| UC Function (`parse_document`) | `EXECUTE` | App service principal |
| MAS Serving Endpoint | `CAN_QUERY` | App service principal |
| SQL Warehouse | `CAN_USE` | App service principal |
| Lakebase tables | `ALL` on tables and sequences | App service principal (Postgres role) |

To find the app's service principal UUID:

```bash
databricks apps get document-chat --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['service_principal_client_id'])"
```

---

## Project Structure

```
document-chat-app/
├── databricks.yml              # DAB bundle configuration
├── app/
│   ├── app.py                  # FastAPI backend (chat, upload, Lakebase)
│   ├── app.yaml                # App deployment config (env vars, resources)
│   ├── requirements.txt        # Python dependencies
│   └── static/                 # Compiled frontend (generated by vite build)
├── frontend/
│   ├── package.json
│   ├── vite.config.js          # Builds into ../app/static/
│   └── src/
│       ├── main.jsx
│       ├── App.jsx             # Main React app (chat UI, file upload, profile)
│       └── App.css
├── notebooks/
│   ├── setup_all_resources.py  # Master setup: UC + permissions + Lakebase
│   ├── setup_lakebase.py       # Standalone Lakebase setup
│   └── setup_uc_resources.sql  # Standalone UC setup
└── sql/
    └── create_parse_function.sql
```

---

## Local Development

```bash
# Terminal 1 — backend
cd app
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com \
SUPERVISOR_ENDPOINT=mas-xxxxxxxx-endpoint \
LAKEBASE_HOST=ep-xxxxx.database.us-east-1.cloud.databricks.com \
LAKEBASE_ENDPOINT=projects/document-chat-db/branches/production/endpoints/primary \
VOLUME_PATH=/Volumes/your_catalog/your_schema/uploads \
uvicorn app:app --reload --port 8000

# Terminal 2 — frontend (proxies /api to localhost:8000)
cd frontend
npm run dev
```

---

## Supported Document Formats

PDF, DOC, DOCX, PPT, PPTX, PNG, JPG, JPEG

---

## Redeployment

After making changes:

```bash
# If frontend changed
cd frontend && npm run build && cd ..

# Deploy via DABs
databricks bundle deploy
databricks apps deploy document-chat \
  --source-code-path /Workspace/Users/<your-email>/.bundle/document-chat/dev/files/app
```
