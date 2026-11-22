// Both screens display the recorded edit minute in GMT.
export function editedLabel(at) {
  if (at == null) return '';
  const date = new Date(Math.floor(at / 60000) * 60000);
  const stamp = date.toUTCString().slice(5, -7);
  return `edited ${stamp.slice(0, -6)} · ${stamp.slice(-5)} GMT`;
}

export function showEdited(node, at) {
  node.hidden = at == null;
  if (node.hidden) return;
  const date = new Date(Math.floor(at / 60000) * 60000);
  node.textContent = editedLabel(at);
  node.dateTime = date.toISOString();
}
