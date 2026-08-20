import { useState, useEffect, useCallback, useRef } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { ClipboardCheck, Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Task {
  id: string;
  text: string;
}

function getStorageKey(userId?: number): string {
  return `daily_tasks_${userId || "guest"}`;
}

function loadTasks(userId?: number): Task[] {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[], userId?: number) {
  localStorage.setItem(getStorageKey(userId), JSON.stringify(tasks));
}

export default function DailyTasks() {
  const { data: user } = useGetMe();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = user?.id;

  useEffect(() => {
    if (userId !== undefined) {
      setTasks(loadTasks(userId));
      setLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    if (loaded && userId !== undefined) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveTasks(tasks, userId), 300);
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [tasks, loaded, userId]);

  const addTask = useCallback(() => {
    setTasks(prev => [...prev, { id: crypto.randomUUID(), text: "" }]);
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateText = useCallback((id: string, text: string) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, text } : t)));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const nextInput = document.querySelector<HTMLInputElement>(`[data-task-idx="${idx + 1}"]`);
      if (nextInput) {
        nextInput.focus();
      } else {
        setTasks(prev => [...prev, { id: crypto.randomUUID(), text: "" }]);
        setTimeout(() => {
          const newInput = document.querySelector<HTMLInputElement>(`[data-task-idx="${idx + 1}"]`);
          newInput?.focus();
        }, 50);
      }
    }
  }, []);

  if (!loaded) {
    return (
      <div className="p-8 text-center text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-violet-100">
          <ClipboardCheck className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Daily Tasks</h1>
          <p className="text-sm text-muted-foreground">Private notepad — stored locally on this device only</p>
        </div>
      </div>

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b text-left">
              <th className="w-14 px-3 py-2.5 font-semibold text-muted-foreground text-center">#</th>
              <th className="px-3 py-2.5 font-semibold text-muted-foreground">Task Description</th>
              <th className="w-10 px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-10 text-center text-muted-foreground">
                  No tasks yet. Click "Add New Task" to get started.
                </td>
              </tr>
            )}
            {tasks.map((task, idx) => (
              <tr key={task.id} className="border-b last:border-b-0 hover:bg-muted/20 group">
                <td className="px-3 py-1.5 text-center text-muted-foreground font-mono text-xs select-none">
                  {idx + 1}
                </td>
                <td className="px-3 py-1.5">
                  <input
                    data-task-idx={idx}
                    type="text"
                    value={task.text}
                    onChange={(e) => updateText(task.id, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    placeholder="Type your task here..."
                    className="w-full bg-transparent outline-none py-1.5 text-sm placeholder:text-muted-foreground/50"
                    autoFocus={idx === tasks.length - 1 && tasks.length > 0 && tasks[tasks.length - 1].text === ""}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="p-1 rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete task"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="mt-4 gap-1.5"
        onClick={addTask}
      >
        <Plus className="h-4 w-4" />
        Add New Task
      </Button>
    </div>
  );
}
