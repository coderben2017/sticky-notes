import { SaveNote, LoadNote, TogglePin, NewNote, GetNoteTitle, QuitApp } from '../wailsjs/go/main/App';
import { WindowHide } from '../wailsjs/runtime/runtime';

const closeDialog = document.getElementById('close-dialog');

document.getElementById('close-btn').addEventListener('click', () => {
  // 显示自定义确认弹窗
  closeDialog.style.display = 'flex';
});

document.getElementById('dialog-hide-btn').addEventListener('click', () => {
  closeDialog.style.display = 'none';
  WindowHide();
});

document.getElementById('dialog-quit-btn').addEventListener('click', async () => {
  closeDialog.style.display = 'none';
  await QuitApp();
});

document.getElementById('dialog-cancel-btn').addEventListener('click', () => {
  closeDialog.style.display = 'none';
});

document.getElementById('pin-btn').addEventListener('click', async () => {
  const isPinned = await TogglePin();
  const pinBtn = document.getElementById('pin-btn');
  if (isPinned) {
    pinBtn.style.color = '#ff4d4f';
    pinBtn.title = '取消置顶';
  } else {
    pinBtn.style.color = '';
    pinBtn.title = '固定置顶';
  }
});

document.getElementById('add-btn').addEventListener('click', async () => {
  // 调用后端启动一个新便签进程
  await NewNote();
});

// 元素引用
const titleEl = document.querySelector('.title');
const todoBtn = document.getElementById('todo-btn');
const todoContainer = document.getElementById('todo-container');
const contentContainer = document.getElementById('content-container');
const todoListEl = document.getElementById('todo-list');
const archiveEl = document.getElementById('archive');
const archiveListEl = document.getElementById('archive-list');
const todoInput = document.getElementById('todo-input');
const todoAddBtn = document.getElementById('todo-add-btn');
const clearArchiveBtn = document.getElementById('clear-archive-btn');

let todoMode = false;
let archiveItems = [];

// Backend helpers for newly added APIs (exposed by Go)
async function saveTitleBackend(title) {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveTitle) {
      await window.go.main.App.SaveTitle(title);
    }
  } catch (e) {
    console.error('保存标题失败', e);
  }
}

async function loadTitleBackend() {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.LoadTitle) {
      return await window.go.main.App.LoadTitle();
    }
  } catch (e) {
    console.error('加载标题失败', e);
  }
  return null;
}

async function saveArchiveBackend(data) {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveArchive) {
      await window.go.main.App.SaveArchive(data);
    }
  } catch (e) {
    console.error('保存归档失败', e);
  }
}

async function loadArchiveBackend() {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.LoadArchive) {
      return await window.go.main.App.LoadArchive();
    }
  } catch (e) {
    console.error('加载归档失败', e);
  }
  return '';
}

// 启动时加载内容
async function init() {
  try {
    // 优先尝试从后端加载自定义标题
    const loadedTitle = await loadTitleBackend();
    const title = loadedTitle || await GetNoteTitle();
    document.title = title;
    document.querySelector('.title').innerText = title;

    const content = await LoadNote();
    if (content) {
      document.getElementById('note-content').value = content;
    }

    // 加载归档
    const arch = await loadArchiveBackend();
    if (arch) {
      archiveItems = arch.split('\n').filter(l => l.trim() !== '');
      renderArchive();
    }
  } catch (e) {
    console.error("加载便签失败", e);
  }
}

init();

// 输入文字时自动保存 (防抖 500ms)
let timeout = null;
const noteArea = document.getElementById('note-content');
noteArea.addEventListener('input', () => {
  clearTimeout(timeout);
  timeout = setTimeout(async () => {
    // 如果处于待办模式，则将文本视为行任务保存；普通模式直接保存文本
    if (todoMode) {
      // 任务由 textarea 的每一行表示
      await SaveNote(noteArea.value);
    } else {
      await SaveNote(noteArea.value);
    }
  }, 500);
});

// 标题编辑：双击编辑，失焦保存
titleEl.addEventListener('dblclick', () => {
  titleEl.contentEditable = 'true';
  titleEl.focus();
});
titleEl.addEventListener('blur', async () => {
  titleEl.contentEditable = 'false';
  const newTitle = titleEl.innerText.trim() || document.title;
  document.title = newTitle;
  await saveTitleBackend(newTitle);
});

// 待办模式渲染与交互
function renderTodoListFromText(text) {
  todoListEl.innerHTML = '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
  lines.forEach((line, idx) => {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between bg-white p-2 rounded shadow-sm';
    const left = document.createElement('div');
    left.className = 'flex items-center gap-3';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.index = idx;
    cb.className = 'w-4 h-4';
    const span = document.createElement('span');
    span.innerText = line;
    span.className = 'text-sm text-gray-800';
    cb.addEventListener('change', async (e) => {
      if (e.target.checked) {
        // 标记完成并归档
        archiveItems.unshift(line);
        await saveArchiveBackend(archiveItems.join('\n'));
        renderArchive();

        // 从当前任务中移除
        lines.splice(idx, 1);
        const remaining = lines.join('\n');
        noteArea.value = remaining;
        await SaveNote(remaining);
        renderTodoListFromText(remaining);
      }
    });
    left.appendChild(cb);
    left.appendChild(span);
    li.appendChild(left);
    // 操作按钮
    const ops = document.createElement('div');
    ops.className = 'flex items-center gap-2';
    const delBtn = document.createElement('button');
    delBtn.className = 'text-xs text-red-500 hover:underline';
    delBtn.innerText = '删除';
    delBtn.addEventListener('click', async () => {
      lines.splice(idx, 1);
      const remaining = lines.join('\n');
      noteArea.value = remaining;
      await SaveNote(remaining);
      renderTodoListFromText(remaining);
    });
    ops.appendChild(delBtn);
    li.appendChild(ops);
    todoListEl.appendChild(li);
  });
}

function renderArchive() {
  if (!archiveItems || archiveItems.length === 0) {
    archiveEl.style.display = 'none';
    archiveListEl.innerHTML = '';
    return;
  }
  archiveEl.style.display = 'block';
  archiveListEl.innerHTML = '';
  archiveItems.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between px-2 py-1 rounded bg-white/60';
    const span = document.createElement('span');
    span.className = 'text-sm text-gray-700';
    span.innerText = item;
    const del = document.createElement('button');
    del.className = 'text-xs text-red-500 hover:underline';
    del.innerText = '删除';
    del.addEventListener('click', async () => {
      archiveItems.splice(idx, 1);
      await saveArchiveBackend(archiveItems.join('\n'));
      renderArchive();
    });
    li.appendChild(span);
    li.appendChild(del);
    archiveListEl.appendChild(li);
  });
}

// 添加任务逻辑
async function addTodoTask(task) {
  if (!task || task.trim() === '') return;
  const current = noteArea.value.split('\n').map(l => l.trim()).filter(l => l !== '');
  current.push(task.trim());
  const text = current.join('\n');
  noteArea.value = text;
  await SaveNote(text);
  renderTodoListFromText(text);
  if (todoInput) todoInput.value = '';
}

todoAddBtn && todoAddBtn.addEventListener('click', async () => {
  await addTodoTask(todoInput.value);
});

todoInput && todoInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    await addTodoTask(todoInput.value);
  }
});

clearArchiveBtn && clearArchiveBtn.addEventListener('click', async () => {
  archiveItems = [];
  await saveArchiveBackend('');
  renderArchive();
});

function toggleTodoMode() {
  todoMode = !todoMode;
  if (todoMode) {
    // 切换到待办视图：隐藏整个内容容器并显示待办容器
    todoContainer.style.display = 'block';
    if (contentContainer) contentContainer.style.display = 'none';
    renderTodoListFromText(noteArea.value);
  } else {
    todoContainer.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'block';
  }
}

todoBtn && todoBtn.addEventListener('click', toggleTodoMode);

// 窗口内快捷键（Ctrl+Alt+N: 新建, Ctrl+Alt+H: 隐藏, Ctrl+Alt+T: 切换待办）
window.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    await NewNote();
  }
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    WindowHide();
  }
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') {
    e.preventDefault();
    toggleTodoMode();
  }
});
