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

// 启动时加载内容
async function init() {
    try {
        const title = await GetNoteTitle();
        document.title = title;
        document.querySelector('.title').innerText = title;

        const content = await LoadNote();
        if (content) {
            document.getElementById('note-content').value = content;
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
        await SaveNote(noteArea.value);
    }, 500);
});
