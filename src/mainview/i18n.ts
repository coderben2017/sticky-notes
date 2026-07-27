const messages = {
  zh: {
    todoImportTitle: "复制为待办？",
    todoImportDescription: "是否按回车分隔，将正文复制到待办列表？",
    todoImportConfirm: "复制并进入",
    todoImportSkip: "直接进入",
  },
  en: {
    todoImportTitle: "Copy as todos?",
    todoImportDescription: "Copy each entered line into the todo list?",
    todoImportConfirm: "Copy & enter",
    todoImportSkip: "Enter only",
  },
} as const;

type MessageKey = keyof typeof messages.zh;

const locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";

export const t = (key: MessageKey) => messages[locale][key];
