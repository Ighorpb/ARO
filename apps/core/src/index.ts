import { config } from "./config";
import { Session } from "./session";
import { Aro } from "./brain/aro";
import { ReminderScheduler } from "./brain/tools/reminders";
import { Hub } from "./hub/ws";
import { TIERS } from "./brain/router";

async function main() {
  const session = new Session();
  await session.load();

  const scheduler = new ReminderScheduler();
  const aro = new Aro(session, scheduler);
  await aro.init();

  const hub = new Hub(aro, session);

  scheduler.on("fired", (r) => {
    console.log(`[lembrete] ${r.text}`);
    hub.broadcast({ type: "reminder.fired", text: r.text });
  });
  await scheduler.load();

  console.log(`${config.name} online — ws://localhost:${config.port}`);
  console.log(`  fast=${TIERS.fast.model}/${TIERS.fast.effort}  main=${TIERS.main.model}/${TIERS.main.effort}  deep=${TIERS.deep.model}/${TIERS.deep.effort}`);
}

main().catch((err) => {
  console.error("[aro] falha ao iniciar:", err);
  process.exit(1);
});
