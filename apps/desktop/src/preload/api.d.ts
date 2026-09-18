import type { AroWindowApi } from "./index";

declare global {
  interface Window {
    aro: AroWindowApi;
  }
}

export {};
