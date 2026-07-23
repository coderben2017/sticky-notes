export const byId = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`找不到界面元素: #${id}`);
  return element as T;
};

export const clear = (element: HTMLElement) => {
  element.replaceChildren();
};

export const button = (
  label: string,
  className: string,
  onClick: () => void | Promise<void>,
) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", () => void onClick());
  return element;
};

export const emptyState = (message: string) => {
  const element = document.createElement("li");
  element.className = "empty-state";
  element.textContent = message;
  return element;
};

export const text = (value: string, className: string) => {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  return element;
};