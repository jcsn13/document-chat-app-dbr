import io
import os
import json
import time
import threading
from pathlib import Path

import psycopg2
import psycopg2.pool
from openai import OpenAI
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from databricks.sdk import WorkspaceClient

app = FastAPI()

SUPERVISOR_ENDPOINT = os.environ.get("SUPERVISOR_ENDPOINT", "mas-8a39578f-endpoint")
VOLUME_PATH = os.environ.get("VOLUME_PATH", "/Volumes/agentbricks_catalog/document_ai_demo/uploads")
LAKEBASE_HOST = os.environ.get("LAKEBASE_HOST", "")
LAKEBASE_ENDPOINT = os.environ.get("LAKEBASE_ENDPOINT", "")

# --- Databricks clients ---

def get_workspace_client():
    return WorkspaceClient()

def get_openai_client():
    w = get_workspace_client()
    token = w.config.authenticate().get("Authorization", "").replace("Bearer ", "")
    return OpenAI(api_key=token, base_url=f"{w.config.host}/serving-endpoints")


# --- Lakebase connection pool with token rotation ---

_db_pool = None
_db_lock = threading.Lock()
_db_token_time = 0

def get_db_conn():
    global _db_pool, _db_token_time
    with _db_lock:
        now = time.time()
        # Recreate pool every 15 minutes (token expires in 1 hour)
        if _db_pool is None or (now - _db_token_time) > 900:
            if _db_pool:
                try:
                    _db_pool.closeall()
                except Exception:
                    pass
            w = get_workspace_client()
            sp_uuid = w.config.client_id
            cred = w.postgres.generate_database_credential(endpoint=LAKEBASE_ENDPOINT)
            _db_pool = psycopg2.pool.ThreadedConnectionPool(
                1, 5,
                host=LAKEBASE_HOST,
                port=5432,
                dbname="databricks_postgres",
                user=sp_uuid,
                password=cred.token,
                sslmode="require",
            )
            _db_token_time = now
    return _db_pool.getconn()

def put_db_conn(conn):
    if _db_pool:
        _db_pool.putconn(conn)


# --- User identity ---

@app.get("/api/me")
def get_current_user(request: Request):
    obo_token = request.headers.get("x-forwarded-access-token")
    username = request.headers.get("x-forwarded-preferred-username")
    if obo_token:
        try:
            w = get_workspace_client()
            uc = WorkspaceClient(host=w.config.host, token=obo_token)
            me = uc.current_user.me()
            return {"name": me.display_name or "", "email": me.user_name or username or ""}
        except Exception:
            pass
    if username:
        return {"name": username.split("@")[0].replace(".", " ").title(), "email": username}
    return {"name": "", "email": ""}


# --- Chat history APIs ---

@app.get("/api/chats")
def list_chats(request: Request):
    email = _get_email(request)
    if not email:
        return {"chats": []}
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, created_at FROM chats WHERE user_email = %s ORDER BY updated_at DESC LIMIT 50",
            (email,)
        )
        chats = [{"id": r[0], "title": r[1], "createdAt": r[2].isoformat()} for r in cur.fetchall()]
        cur.close()
        return {"chats": chats}
    finally:
        put_db_conn(conn)


@app.post("/api/chats")
def create_chat(request: Request, body: dict):
    email = _get_email(request)
    chat_id = body.get("id", "")
    title = body.get("title", "New chat")
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO chats (id, user_email, title) VALUES (%s, %s, %s) ON CONFLICT (id) DO UPDATE SET title = %s, updated_at = NOW()",
            (chat_id, email, title, title)
        )
        conn.commit()
        cur.close()
        return {"id": chat_id}
    finally:
        put_db_conn(conn)


@app.get("/api/chats/{chat_id}/messages")
def get_messages(chat_id: str):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT role, content, agent_content, thinking, attachments FROM messages WHERE chat_id = %s ORDER BY created_at",
            (chat_id,)
        )
        messages = [
            {
                "role": r[0],
                "content": r[1],
                "agentContent": r[2],
                "thinking": r[3] or "",
                "thinkingDone": True,
                "attachments": r[4] if r[4] else [],
            }
            for r in cur.fetchall()
        ]
        cur.close()
        return {"messages": messages}
    finally:
        put_db_conn(conn)


class SaveMessageRequest(BaseModel):
    role: str
    content: str
    agentContent: str = ""
    thinking: str = ""
    attachments: list = []


@app.post("/api/chats/{chat_id}/messages")
def save_message(chat_id: str, msg: SaveMessageRequest):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO messages (chat_id, role, content, agent_content, thinking, attachments) VALUES (%s, %s, %s, %s, %s, %s)",
            (chat_id, msg.role, msg.content, msg.agentContent, msg.thinking, json.dumps(msg.attachments))
        )
        cur.execute("UPDATE chats SET updated_at = NOW() WHERE id = %s", (chat_id,))
        conn.commit()
        cur.close()
        return {"ok": True}
    finally:
        put_db_conn(conn)


# --- Document upload ---

@app.post("/api/upload")
async def upload_document(request: Request, file: UploadFile = File(...)):
    w = get_workspace_client()
    file_bytes = await file.read()
    volume_file_path = f"{VOLUME_PATH}/{file.filename}"
    try:
        w.files.upload(volume_file_path, io.BytesIO(file_bytes), overwrite=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

    # Persist document record
    email = _get_email(request)
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO documents (user_email, filename, volume_path) VALUES (%s, %s, %s)",
            (email, file.filename, volume_file_path)
        )
        conn.commit()
        cur.close()
    finally:
        put_db_conn(conn)

    return {"filename": file.filename, "path": volume_file_path, "size": len(file_bytes)}


@app.get("/api/documents")
def list_documents(request: Request):
    email = _get_email(request)
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT filename, volume_path, uploaded_at FROM documents WHERE user_email = %s ORDER BY uploaded_at DESC LIMIT 100",
            (email,)
        )
        docs = [{"filename": r[0], "path": r[1], "uploadedAt": r[2].isoformat()} for r in cur.fetchall()]
        cur.close()
        return {"documents": docs}
    finally:
        put_db_conn(conn)


# --- Chat streaming ---

class ChatRequest(BaseModel):
    messages: list[dict]


@app.post("/api/chat")
def chat_with_supervisor(request: ChatRequest):
    def event_stream():
        try:
            client = get_openai_client()
            stream = client.responses.create(
                model=SUPERVISOR_ENDPOINT, input=request.messages, stream=True,
            )
            thinking_started = False
            for event in stream:
                etype = getattr(event, "type", "")
                if etype in ("response.reasoning_text.delta", "response.reasoning_summary_text.delta"):
                    if not thinking_started:
                        yield f"event: thinking_start\ndata: {{}}\n\n"
                        thinking_started = True
                    yield f"event: thinking\ndata: {json.dumps({'delta': event.delta})}\n\n"
                elif etype in ("response.reasoning_text.done", "response.reasoning_summary_text.done"):
                    if thinking_started:
                        yield f"event: thinking_done\ndata: {{}}\n\n"
                        thinking_started = False
                elif etype == "response.output_text.delta":
                    if thinking_started:
                        yield f"event: thinking_done\ndata: {{}}\n\n"
                        thinking_started = False
                    yield f"event: text\ndata: {json.dumps({'delta': event.delta})}\n\n"
                elif etype == "response.completed":
                    yield f"event: done\ndata: {{}}\n\n"
                elif etype == "response.failed":
                    yield f"event: error\ndata: {json.dumps({'message': 'Agent response failed'})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- Helpers ---

def _get_email(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "anonymous")


# --- Static files ---

static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_react(full_path: str):
        file_path = static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(static_dir / "index.html")
