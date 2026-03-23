# Databricks notebook source
# Setup Lakebase database for the Document Chat app
# This notebook automates Lakebase project creation and schema setup

# COMMAND ----------

import json, time

# COMMAND ----------

# Configuration
PROJECT_NAME = "document-chat-db"
APP_SP_UUID = "9e0e202e-da5f-45b6-aaa1-ac5d6473e5ee"

# COMMAND ----------

from databricks.sdk import WorkspaceClient
w = WorkspaceClient()

# COMMAND ----------

# Create project if it doesn't exist
existing = [p for p in w.postgres.list_projects() if p.name == f"projects/{PROJECT_NAME}"]
if not existing:
    print(f"Creating Lakebase project: {PROJECT_NAME}")
    w.postgres.create_project(PROJECT_NAME)
    time.sleep(5)
    print("Project created")
else:
    print(f"Project {PROJECT_NAME} already exists")

# COMMAND ----------

# Get the production branch endpoint
branches = list(w.postgres.list_branches(f"projects/{PROJECT_NAME}"))
branch = next(b for b in branches if "production" in b.name)
print(f"Branch: {branch.name}")

endpoints = list(w.postgres.list_endpoints(branch.name))
endpoint = endpoints[0]
print(f"Endpoint: {endpoint.name}")
print(f"Host: {endpoint.status.hosts.host}")

# COMMAND ----------

# Generate a credential and run schema setup
cred = w.postgres.generate_database_credential(endpoint=endpoint.name)
host = endpoint.status.hosts.host

import psycopg2
conn = psycopg2.connect(
    host=host,
    port=5432,
    dbname="databricks_postgres",
    user=cred.username,
    password=cred.token,
    sslmode="require"
)
conn.autocommit = True
cur = conn.cursor()

# Create extension and SP role
cur.execute("CREATE EXTENSION IF NOT EXISTS databricks_auth;")
try:
    cur.execute(f"SELECT databricks_create_role('{APP_SP_UUID}', 'SERVICE_PRINCIPAL');")
except Exception as e:
    if "already exists" in str(e).lower():
        print("SP role already exists")
    else:
        raise

# Create tables
cur.execute("""
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
""")

cur.execute("""
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    agent_content TEXT,
    thinking TEXT,
    attachments JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
""")

cur.execute("""
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    chat_id TEXT,
    user_email TEXT NOT NULL,
    filename TEXT NOT NULL,
    volume_path TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
""")

cur.execute("CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_email);")
cur.execute("CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);")
cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_email);")
cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_chat ON documents(chat_id);")

# Grant permissions
cur.execute(f'GRANT ALL ON ALL TABLES IN SCHEMA public TO "{APP_SP_UUID}";')
cur.execute(f'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "{APP_SP_UUID}";')
cur.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "{APP_SP_UUID}";')
cur.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "{APP_SP_UUID}";')

cur.close()
conn.close()
print("Lakebase schema setup complete!")

# COMMAND ----------

print(f"Connection info for app.yaml env vars:")
print(f"  LAKEBASE_HOST: {host}")
print(f"  LAKEBASE_ENDPOINT: {endpoint.name}")
