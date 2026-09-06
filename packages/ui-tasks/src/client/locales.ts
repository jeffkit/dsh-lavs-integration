/** `tasks` namespace dictionaries (the tasks view tab's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.tasks': '任务',
  'empty.title': '本会话还没有任务清单',
  'empty.hint': '让 agent 用 todo 工具创建清单后，这里会变成可操作的任务视图。',
  'empty.create': '创建任务',
  'item.toggle.pending': '标记为进行中',
  'item.toggle.in_progress': '标记为已完成',
  'item.toggle.completed': '恢复为待办',
  'send.prefix.pending': '请把任务「{content}」标记为 in_progress（用 todo_write 更新清单）',
  'send.prefix.in_progress': '请把任务「{content}」标记为 completed（用 todo_write 更新清单）',
  'send.prefix.completed': '请把任务「{content}」恢复为 pending（用 todo_write 更新清单）',
  'create.placeholder': '描述一个新任务…',
  'create.submit': '发送给 agent',
  'create.send': '请用 todo_write 把「{content}」加入任务清单（保持其余项不变）',
  'status.pending': '待办',
  'status.in_progress': '进行中',
  'status.completed': '已完成',
  'footer.note': '本视图的每次操作都作为一条会话消息发给 agent——全程可审计、可回放。',
} satisfies Record<string, string>

/** The tasks namespace key union. */
export type TasksKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The tasks view tab label and task-action strings. */
    'tasks': TasksKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'view.tasks': 'Tasks',
  'empty.title': 'No task list in this session yet',
  'empty.hint': 'Ask the agent to create one with the todo tool; this becomes an actionable view.',
  'empty.create': 'Create a task',
  'item.toggle.pending': 'Mark as in progress',
  'item.toggle.in_progress': 'Mark as completed',
  'item.toggle.completed': 'Restore to pending',
  'send.prefix.pending': 'Please mark the task "{content}" as in_progress (update the list with todo_write)',
  'send.prefix.in_progress': 'Please mark the task "{content}" as completed (update the list with todo_write)',
  'send.prefix.completed': 'Please restore the task "{content}" to pending (update the list with todo_write)',
  'create.placeholder': 'Describe a new task…',
  'create.submit': 'Send to agent',
  'create.send': 'Please add "{content}" to the task list with todo_write (keep the other items unchanged)',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
  'footer.note': 'Every action here is sent to the agent as a session message — auditable and replayable.',
} satisfies Record<TasksKey, string>

/** Locale namespace owned by this plugin. */
export const NS = 'tasks'
