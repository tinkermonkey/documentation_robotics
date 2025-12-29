import { useEffect, useState } from 'react';
import { Button, TextInput, ListGroup, Spinner } from 'flowbite-react';

type Todo = {
  id: number;
  title: string;
  completed: boolean;
};

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchTodos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/todos');
      if (!res.ok) throw new Error('Failed to fetch todos');
      const data = await res.json();
      setTodos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodos();
  }, []);

  const addTodo = async () => {
    if (!title.trim()) return;
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to add todo');
      setTitle('');
      await fetchTodos();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleTodo = async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}/toggle`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to toggle todo');
      await fetchTodos();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteTodo = async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete todo');
      await fetchTodos();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Todos</h1>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a todo"
        />
        <Button onClick={addTodo}>Add</Button>
        <Button color="light" onClick={fetchTodos}>Refresh</Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Spinner /> <span>Loading...</span>
        </div>
      ) : (
        <ListGroup>
          {todos.map((t) => (
            <ListGroup.Item key={t.id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <button onClick={() => toggleTodo(t.id)} style={{ textDecoration: t.completed ? 'line-through' : 'none' }}>
                  {t.title}
                </button>
                <Button color="failure" onClick={() => deleteTodo(t.id)}>Delete</Button>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  );
}
