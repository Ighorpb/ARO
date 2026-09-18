import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  name: "ARO",
  port: Number(process.env.ARO_PORT ?? 7777),
  city: process.env.ARO_CITY ?? "São Paulo",
  cacheTtl: (process.env.ARO_CACHE_TTL === "5m" ? "5m" : "1h") as "5m" | "1h",
  dataDir: process.env.ARO_DATA_DIR ? path.resolve(process.env.ARO_DATA_DIR) : path.resolve(here, "../data"),
  get memoryDir() {
    return path.join(this.dataDir, "memory");
  },
  get sessionFile() {
    return path.join(this.dataDir, "session.json");
  },
  get notesFile() {
    return path.join(this.dataDir, "notes.json");
  },
  get remindersFile() {
    return path.join(this.dataDir, "reminders.json");
  },
  get appsFile() {
    return path.join(this.dataDir, "apps.json");
  },
};
