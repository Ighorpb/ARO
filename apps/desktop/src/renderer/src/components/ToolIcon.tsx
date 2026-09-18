/** Glifos mínimos por ferramenta — 1 traço, sem preenchimento. */
const PATHS: Record<string, string> = {
  get_datetime: "M8 4v4l2.5 1.5M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z",
  get_weather: "M5 12.5h6.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6 1.2A2.5 2.5 0 0 0 5 12.5Z",
  notes: "M4 2.5h8v11H4zM6 6h4M6 8.5h4M6 11h2.5",
  reminders: "M8 2a4 4 0 0 0-4 4v3l-1.5 2h11L12 9V6a4 4 0 0 0-4-4ZM6.5 13a1.5 1.5 0 0 0 3 0",
  open_url: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13",
  open_app: "M2.5 3.5h11v9h-11zM2.5 6h11M5 4.75h.01M7 4.75h.01",
  memory: "M8 2.5a4 4 0 0 0-4 4c0 1.6.8 2.6 1.5 3.3V12h5v-2.2c.7-.7 1.5-1.7 1.5-3.3a4 4 0 0 0-4-4ZM6.5 14h3",
  web_search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.3 10.3 14 14",
};

export function ToolIcon({ name }: { name: string }) {
  const d = PATHS[name] ?? "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
