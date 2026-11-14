import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../app/package.json", import.meta.url));
// 仅可信构造调用；没有环境变量或客户端开关，没有网络能力，不分析人像。
export function createLocalPlayerAiProvider() {
  const records = new Map();
  async function geometry(color) {
    const sharp = require("sharp");
    return {
      mimeType: "image/png",
      bytes: await sharp({
        create: { width: 256, height: 256, channels: 3, background: color },
      })
        .png()
        .toBuffer(),
    };
  }
  return {
    mode: "local-simulation",
    id: "local-geometry",
    termsVersion: "simulation-v1",
    samples: [
      { id: "purple-square", label: "紫色几何测试图" },
      { id: "white-square", label: "白色几何测试图" },
    ],
    styles: [{ id: "purple-card", label: "紫色测试卡（非AI生成）" }],
    async sample(id) {
      if (!["purple-square", "white-square"].includes(id))
        throw Error("未知合成样本");
      return geometry(id === "purple-square" ? "#8845a0" : "#ffffff");
    },
    async submit({ requestId }) {
      if (records.has(requestId)) return records.get(requestId);
      const value = {
        state: "succeeded",
        externalRef: randomUUID(),
        images: [await geometry("#8845a0")],
        charge: { amountMinor: 0, reference: randomUUID() },
      };
      if (records.size >= 128) records.delete(records.keys().next().value);
      records.set(requestId, value);
      return value;
    },
    async query(externalRef) {
      return (
        [...records.values()].find((x) => x.externalRef === externalRef) ?? {
          state: "unknown",
        }
      );
    },
    async cancel() {
      return { cancelled: true, chargeKnown: false };
    },
  };
}
