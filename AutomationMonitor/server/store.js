import fs from "node:fs/promises";
import path from "node:path";

// Tiny JSON-file store for monitor state (alert acks, channels, deploy targets/history).
export function createStore(filePath, defaults) {
  let data = null;

  async function load() {
    if (data) return data;
    try {
      data = { ...structuredClone(defaults), ...JSON.parse(await fs.readFile(filePath, "utf8")) };
    } catch {
      data = structuredClone(defaults);
    }
    return data;
  }

  async function save() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  return { load, save };
}
