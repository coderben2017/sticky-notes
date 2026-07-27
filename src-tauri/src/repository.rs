use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::models::{
    ArchivedTodoItem, DockEdge, NoteSnapshot, RepositoryState, StoredNote, TodoItem, WindowFrame,
};

pub struct NoteRepository {
    path: PathBuf,
    state: RepositoryState,
}

impl NoteRepository {
    pub fn load(path: PathBuf, legacy_content_paths: &[PathBuf]) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建数据目录失败: {error}"))?;
        }

        let backup_path = sibling_path(&path, "bak");
        if !path.exists() && backup_path.exists() {
            fs::rename(&backup_path, &path)
                .map_err(|error| format!("恢复便签数据备份失败: {error}"))?;
        }

        if !path.exists() {
            let content = read_legacy_content(legacy_content_paths);
            let repository = Self {
                path,
                state: create_initial_state(content),
            };
            repository.persist()?;
            return Ok(repository);
        }

        match read_state(&path) {
            Ok(state) => Ok(Self { path, state }),
            Err(error) => {
                let corrupt_path = sibling_path(&path, &format!("corrupt-{}", unix_millis()));
                fs::rename(&path, &corrupt_path).map_err(|backup_error| {
                    format!("读取便签数据失败，且无法备份原文件: {error}; {backup_error}")
                })?;

                eprintln!(
                    "读取便签数据失败，原文件已备份到 {}: {}",
                    corrupt_path.display(),
                    error
                );
                let repository = Self {
                    path,
                    state: create_initial_state(String::new()),
                };
                repository.persist()?;
                Ok(repository)
            }
        }
    }

    pub fn list(&self) -> Vec<NoteSnapshot> {
        self.state
            .note_order
            .iter()
            .filter_map(|id| self.state.notes.get(id))
            .map(|note| note.snapshot.clone())
            .collect()
    }

    pub fn get(&self, id: &str) -> Result<NoteSnapshot, String> {
        Ok(self.require_note(id)?.snapshot.clone())
    }

    pub fn get_frame(&self, id: &str) -> Result<Option<WindowFrame>, String> {
        Ok(self.require_note(id)?.frame)
    }

    pub fn get_dock(&self, id: &str) -> Result<Option<DockEdge>, String> {
        Ok(self.require_note(id)?.dock)
    }

    pub fn create(&mut self) -> Result<NoteSnapshot, String> {
        let note = create_default_note(self.state.note_order.len() + 1);
        let id = note.snapshot.id.clone();
        self.state.note_order.push(id.clone());
        self.state.notes.insert(id, note.clone());
        self.persist()?;
        Ok(note.snapshot)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        self.require_note(id)?;
        self.state.notes.remove(id);
        self.state.note_order.retain(|note_id| note_id != id);
        self.persist()
    }

    pub fn save_content(&mut self, id: &str, content: String) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| note.snapshot.content = content)
    }

    pub fn rename(&mut self, id: &str, title: String) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            let title = clean_text(&title, 80);
            note.snapshot.title = if title.is_empty() {
                "便签".to_string()
            } else {
                title
            };
        })
    }

    pub fn toggle_pin(&mut self, id: &str) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| note.snapshot.pinned = !note.snapshot.pinned)
    }

    pub fn set_todo_mode(
        &mut self,
        id: &str,
        enabled: bool,
        copy_content: bool,
    ) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            if enabled && copy_content && note.snapshot.todos.is_empty() {
                let todo_texts = note
                    .snapshot
                    .content
                    .lines()
                    .map(|line| clean_text(line, 500))
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>();
                note.snapshot.todos.extend(todo_texts.into_iter().map(|text| TodoItem {
                    id: create_id(),
                    text,
                    created_at: now(),
                }));
            }
            note.snapshot.todo_mode = enabled;
        })
    }

    pub fn set_placement(
        &mut self,
        id: &str,
        frame: WindowFrame,
        dock: Option<DockEdge>,
    ) -> Result<(), String> {
        let note = self.require_note(id)?;
        if note.frame == Some(frame) && note.dock == dock {
            return Ok(());
        }

        let note = self.require_note_mut(id)?;
        note.frame = Some(frame);
        note.dock = dock;
        self.persist()
    }

    pub fn add_todo(&mut self, id: &str, text: String) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            let text = clean_text(&text, 500);
            if text.is_empty() {
                return;
            }

            note.snapshot.todos.push(TodoItem {
                id: create_id(),
                text,
                created_at: now(),
            });
        })
    }

    pub fn update_todo(
        &mut self,
        id: &str,
        todo_id: &str,
        text: String,
    ) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            let text = clean_text(&text, 500);
            if text.is_empty() {
                note.snapshot.todos.retain(|todo| todo.id != todo_id);
                return;
            }

            if let Some(todo) = note.snapshot.todos.iter_mut().find(|todo| todo.id == todo_id) {
                todo.text = text;
            }
        })
    }

    pub fn delete_todo(&mut self, id: &str, todo_id: &str) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            note.snapshot.todos.retain(|todo| todo.id != todo_id);
        })
    }

    pub fn complete_todo(&mut self, id: &str, todo_id: &str) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            let Some(index) = note.snapshot.todos.iter().position(|todo| todo.id == todo_id) else {
                return;
            };
            let todo = note.snapshot.todos.remove(index);
            note.snapshot.archive.insert(
                0,
                ArchivedTodoItem {
                    id: todo.id,
                    text: todo.text,
                    created_at: todo.created_at,
                    completed_at: now(),
                },
            );
        })
    }

    pub fn restore_todo(&mut self, id: &str, todo_id: &str) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            let Some(index) = note.snapshot.archive.iter().position(|todo| todo.id == todo_id) else {
                return;
            };
            let todo = note.snapshot.archive.remove(index);
            note.snapshot.todos.push(TodoItem {
                id: todo.id,
                text: todo.text,
                created_at: todo.created_at,
            });
        })
    }

    pub fn delete_archived_todo(
        &mut self,
        id: &str,
        todo_id: &str,
    ) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| {
            note.snapshot.archive.retain(|todo| todo.id != todo_id);
        })
    }

    pub fn clear_archive(&mut self, id: &str) -> Result<NoteSnapshot, String> {
        self.commit(id, |note| note.snapshot.archive.clear())
    }

    fn require_note(&self, id: &str) -> Result<&StoredNote, String> {
        self.state
            .notes
            .get(id)
            .ok_or_else(|| format!("便签不存在: {id}"))
    }

    fn require_note_mut(&mut self, id: &str) -> Result<&mut StoredNote, String> {
        self.state
            .notes
            .get_mut(id)
            .ok_or_else(|| format!("便签不存在: {id}"))
    }

    fn commit<F>(&mut self, id: &str, transform: F) -> Result<NoteSnapshot, String>
    where
        F: FnOnce(&mut StoredNote),
    {
        let mut next = self.require_note(id)?.clone();
        transform(&mut next);
        next.snapshot.updated_at = now();
        self.state.notes.insert(id.to_string(), next.clone());
        self.persist()?;
        Ok(next.snapshot)
    }

    fn persist(&self) -> Result<(), String> {
        let temporary_path = sibling_path(&self.path, "tmp");
        let backup_path = sibling_path(&self.path, "bak");
        let content = serde_json::to_string_pretty(&self.state)
            .map_err(|error| format!("序列化便签数据失败: {error}"))?;
        fs::write(&temporary_path, content)
            .map_err(|error| format!("写入便签临时文件失败: {error}"))?;

        if backup_path.exists() {
            fs::remove_file(&backup_path)
                .map_err(|error| format!("清理旧便签备份失败: {error}"))?;
        }
        if self.path.exists() {
            fs::rename(&self.path, &backup_path)
                .map_err(|error| format!("备份当前便签数据失败: {error}"))?;
        }

        if let Err(error) = fs::rename(&temporary_path, &self.path) {
            if backup_path.exists() {
                let _ = fs::rename(&backup_path, &self.path);
            }
            return Err(format!("替换便签数据失败: {error}"));
        }

        if backup_path.exists() {
            fs::remove_file(&backup_path)
                .map_err(|error| format!("清理便签备份失败: {error}"))?;
        }
        Ok(())
    }
}

fn read_state(path: &Path) -> Result<RepositoryState, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("读取便签数据失败: {error}"))?;
    let mut state: RepositoryState =
        serde_json::from_str(&raw).map_err(|error| format!("解析便签数据失败: {error}"))?;
    if state.version != 1 {
        return Err(format!("不支持的便签数据版本: {}", state.version));
    }

    state.note_order.retain(|id| state.notes.contains_key(id));
    Ok(state)
}

fn read_legacy_content(paths: &[PathBuf]) -> String {
    for path in paths {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let content = content.trim_start_matches('\u{feff}').to_string();
        if !content.is_empty() {
            return content;
        }
    }
    String::new()
}

fn create_initial_state(content: String) -> RepositoryState {
    let mut note = create_default_note(1);
    note.snapshot.content = content;
    let id = note.snapshot.id.clone();
    RepositoryState {
        version: 1,
        note_order: vec![id.clone()],
        notes: [(id, note)].into(),
    }
}

fn create_default_note(index: usize) -> StoredNote {
    let timestamp = now();
    let title = if index == 1 {
        "便签".to_string()
    } else {
        format!("便签 #{index}")
    };

    StoredNote {
        snapshot: NoteSnapshot {
            id: create_id(),
            title,
            content: String::new(),
            todos: Vec::new(),
            archive: Vec::new(),
            todo_mode: false,
            pinned: false,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        },
        frame: None,
        dock: None,
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn create_id() -> String {
    Uuid::new_v4().to_string()
}

fn clean_text(value: &str, max_length: usize) -> String {
    value.trim().chars().take(max_length).collect()
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), suffix))
}
