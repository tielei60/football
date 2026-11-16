// 仅从已显示的姓名派生占位字，不生成头像或推断身份。
function playerInitial(name) {
  if (typeof name !== "string") return "球";
  const clean = name.trim().replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").trim();
  const first = Array.from(clean)[0];
  // Array.from 保留扩展汉字完整码点；拒绝孤立代理项。
  return first && !/^[\ud800-\udfff]$/.test(first) ? first : "球";
}
module.exports = { playerInitial };
