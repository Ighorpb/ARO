import { clockTool } from "./clock";
import { weatherTool } from "./weather";
import { notesTool } from "./notes";
import { createRemindersTool, type ReminderScheduler } from "./reminders";
import { openUrlTool, openAppTool } from "./open";
import { clipboardTool, mediaTool, seeScreenTool } from "./system";

/** Tools executadas localmente. Ordem fixa — muda ordem, invalida cache. */
export function createLocalTools(scheduler: ReminderScheduler) {
  return [
    clockTool,
    weatherTool,
    notesTool,
    createRemindersTool(scheduler),
    openUrlTool,
    openAppTool,
    seeScreenTool,
    clipboardTool,
    mediaTool,
  ].map((tool) => ({ ...tool, eager_input_streaming: true }));
}
