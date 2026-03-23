# Databricks notebook source
# Automated setup for ALL Document Chat App resources

# COMMAND ----------

# MAGIC %pip install psycopg2-binary databricks-sdk --upgrade -q

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

import time, json
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

APP_NAME = "document-chat"
CATALOG = "agentbricks_catalog"
SCHEMA = "document_ai_demo"
VOLUME = "uploads"
LAKEBASE_PROJECT = "document-chat-db"
SERVING_ENDPOINT = "mas-8a39578f-endpoint"
WAREHOUSE_ID = "77819a974fbc3b34"

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Look up App Service Principal

# COMMAND ----------

app = w.apps.get(APP_NAME)
sp_uuid = app.service_principal_client_id
sp_id = app.service_principal_id
print(f"App SP UUID: {sp_uuid}")
print(f"App SP ID: {sp_id}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Unity Catalog Resources

# COMMAND ----------

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.{VOLUME}")
spark.sql(f"""
CREATE OR REPLACE FUNCTION {CATALOG}.{SCHEMA}.parse_document(
  file_content BINARY COMMENT 'Binary content of a document file. Use read_files() to provide this.'
)
RETURNS STRING
LANGUAGE SQL
COMMENT 'Parses document content using AI_PARSE_DOCUMENT. Returns extracted text in markdown.'
RETURN CAST(ai_parse_document(file_content, map('outputFormat', 'MARKDOWN')) AS STRING)
""")
print("UC resources created")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. UC Permissions

# COMMAND ----------

for stmt in [
    f"GRANT USE CATALOG ON CATALOG {CATALOG} TO `{sp_uuid}`",
    f"GRANT USE SCHEMA ON SCHEMA {CATALOG}.{SCHEMA} TO `{sp_uuid}`",
    f"GRANT READ VOLUME ON VOLUME {CATALOG}.{SCHEMA}.{VOLUME} TO `{sp_uuid}`",
    f"GRANT WRITE VOLUME ON VOLUME {CATALOG}.{SCHEMA}.{VOLUME} TO `{sp_uuid}`",
    f"GRANT EXECUTE ON FUNCTION {CATALOG}.{SCHEMA}.parse_document TO `{sp_uuid}`",
]:
    spark.sql(stmt)
print("UC permissions granted")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Serving Endpoint & Warehouse Permissions

# COMMAND ----------

import requests as req

host = w.config.host
headers = {k: v for k, v in w.config.authenticate().items()}

ep = w.serving_endpoints.get(SERVING_ENDPOINT)
r = req.patch(f"{host}/api/2.0/permissions/serving-endpoints/{ep.id}", headers=headers,
    json={"access_control_list": [{"service_principal_name": sp_uuid, "permission_level": "CAN_QUERY"}]})
print(f"Serving endpoint permission: {r.status_code}")

r = req.patch(f"{host}/api/2.0/permissions/sql/warehouses/{WAREHOUSE_ID}", headers=headers,
    json={"access_control_list": [{"service_principal_name": sp_uuid, "permission_level": "CAN_USE"}]})
print(f"Warehouse permission: {r.status_code}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Lakebase Project & Schema

# COMMAND ----------

existing = [p for p in w.postgres.list_projects() if p.name == f"projects/{LAKEBASE_PROJECT}"]
if not existing:
    print(f"Creating Lakebase project: {LAKEBASE_PROJECT}")
    w.postgres.create_project(LAKEBASE_PROJECT)
    for _ in range(30):
        time.sleep(3)
        branches = list(w.postgres.list_branches(f"projects/{LAKEBASE_PROJECT}"))
        if branches and branches[0].status.current_state == "READY":
            break
    print("Project created")
else:
    print(f"Project {LAKEBASE_PROJECT} already exists")

# COMMAND ----------

branches = list(w.postgres.list_branches(f"projects/{LAKEBASE_PROJECT}"))
branch = next(b for b in branches if "production" in b.name)
endpoints = list(w.postgres.list_endpoints(branch.name))
endpoint = endpoints[0]
lb_host = endpoint.status.hosts.host
lb_endpoint_name = endpoint.name
print(f"Host: {lb_host}")
print(f"Endpoint: {lb_endpoint_name}")

# COMMAND ----------

import psycopg2

cred = w.postgres.generate_database_credential(endpoint=lb_endpoint_name)
me = w.current_user.me()
conn = psycopg2.connect(host=lb_host, port=5432, dbname="databricks_postgres",
    user=me.user_name, password=cred.token, sslmode="require")
conn.autocommit = True
cur = conn.cursor()

cur.execute("CREATE EXTENSION IF NOT EXISTS databricks_auth;")
try:
    cur.execute(f"SELECT databricks_create_role('{sp_uuid}', 'SERVICE_PRINCIPAL');")
    print("SP Postgres role created")
except Exception as e:
    conn.rollback()
    print(f"SP role: {e}")

cur.execute("""CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, user_email TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());""")
cur.execute("""CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', agent_content TEXT, thinking TEXT,
    attachments JSONB DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());""")
cur.execute("""CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY, chat_id TEXT, user_email TEXT NOT NULL,
    filename TEXT NOT NULL, volume_path TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());""")

for idx in ["CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_email)",
            "CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)",
            "CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_email)",
            "CREATE INDEX IF NOT EXISTS idx_documents_chat ON documents(chat_id)"]:
    cur.execute(idx)

cur.execute(f'GRANT ALL ON ALL TABLES IN SCHEMA public TO "{sp_uuid}";')
cur.execute(f'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "{sp_uuid}";')
cur.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "{sp_uuid}";')
cur.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "{sp_uuid}";')

cur.close()
conn.close()
print("Lakebase schema complete!")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary

# COMMAND ----------

print("=" * 60)
print("ALL RESOURCES PROVISIONED")
print("=" * 60)
print(f"App SP:           {sp_uuid}")
print(f"UC Function:      {CATALOG}.{SCHEMA}.parse_document")
print(f"Volume:           /Volumes/{CATALOG}/{SCHEMA}/{VOLUME}")
print(f"Lakebase Host:    {lb_host}")
print(f"Lakebase Endpoint:{lb_endpoint_name}")
