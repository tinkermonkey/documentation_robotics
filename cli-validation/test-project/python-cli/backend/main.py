import sqlite3
from contextlib import closing
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DB_PATH = Path(__file__).parent / "todo.db"

app = FastAPI(title="Todo API", version="0.1.0")


class TodoIn(BaseModel):
    title: str
    done: bool = False


class Todo(TodoIn):
    id: int


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.commit()


@app.on_event("startup")
async def startup() -> None:
    init_db()


@app.get("/todos", response_model=List[Todo])
def list_todos() -> List[Todo]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT id, title, done FROM todos ORDER BY id").fetchall()
        return [Todo(id=row["id"], title=row["title"], done=bool(row["done"])) for row in rows]


@app.post("/todos", response_model=Todo, status_code=201)
def create_todo(todo: TodoIn) -> Todo:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cur = conn.execute(
            "INSERT INTO todos (title, done) VALUES (?, ?)",
            (todo.title.strip(), int(todo.done)),
        )
        conn.commit()
        todo_id = cur.lastrowid
    return Todo(id=todo_id, **todo.model_dump())


@app.put("/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: int, todo: TodoIn) -> Todo:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cur = conn.execute(
            "UPDATE todos SET title = ?, done = ? WHERE id = ?",
            (todo.title.strip(), int(todo.done), todo_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo not found")
        conn.commit()
    return Todo(id=todo_id, **todo.model_dump())


@app.delete("/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: int) -> None:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cur = conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo not found")
        conn.commit()
