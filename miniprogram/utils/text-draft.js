// 三方比较仅处理文字草稿，不改变相册版本或权限。
function mergeText(previous, draft, incoming, conflicted = false) {
  const dirty = draft !== previous;
  return {
    value: dirty ? draft : incoming,
    conflict:
      dirty && draft !== incoming && (conflicted || incoming !== previous),
  };
}
function replacementMessage(server, draft) {
  const excerpt = (value) =>
    value.length > 300 ? value.slice(0, 300) + "…（节选）" : value || "（空）";
  return (
    "服务器文字已变化。确认用编辑框中保留的完整文字替换本次核对的服务器版本？\n\n服务器：" +
    excerpt(server) +
    "\n\n保留文字：" +
    excerpt(draft) +
    "\n\n长文仅展示节选，完整草稿仍在编辑框；取消不会保存。"
  );
}
module.exports = { mergeText, replacementMessage };
