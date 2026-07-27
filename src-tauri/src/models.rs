use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowFrame {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedTodoItem {
    pub id: String,
    pub text: String,
    pub created_at: String,
    pub completed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSnapshot {
    pub id: String,
    pub title: String,
    pub content: String,
    pub todos: Vec<TodoItem>,
    pub archive: Vec<ArchivedTodoItem>,
    #[serde(default)]
    pub todo_mode: bool,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNote {
    #[serde(flatten)]
    pub snapshot: NoteSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<WindowFrame>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dock: Option<DockEdge>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryState {
    pub version: u8,
    pub note_order: Vec<String>,
    pub notes: std::collections::HashMap<String, StoredNote>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedNote {
    pub id: String,
}
