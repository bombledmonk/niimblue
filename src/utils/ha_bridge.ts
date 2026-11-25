/**
 * Home Assistant bridge.
 *
 * When NiimBlue runs inside the "NIIMBOT Label Designer" panel (a same-origin iframe in
 * Home Assistant), printing goes through Home Assistant instead of Web Bluetooth: the
 * rendered page is sent as a PNG to the `niimbot_designer` integration, which prints it
 * with hass-niimbot and keeps the print history. Home Assistant owns the Bluetooth link.
 */
import { getPrinterMetaByModel, type PrintDirection, type PrinterModel, type PrinterModelMeta } from "@mmote/niimbluelib";
import { get, writable } from "svelte/store";
import { printerMeta } from "$/stores/app";
import type { ExportedLabelTemplate } from "$/types";

interface HassEntity {
  entity_id: string;
  state: string;
}

interface HassEntityRegistryEntry {
  entity_id: string;
  device_id?: string;
  platform?: string;
}

interface HassDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  model?: string | null;
}

interface Hass {
  states: Record<string, HassEntity>;
  entities: Record<string, HassEntityRegistryEntry>;
  devices: Record<string, HassDevice>;
  connection: { sendMessagePromise<T>(msg: Record<string, unknown>): Promise<T> };
}

export interface HaPrinter {
  deviceId: string;
  name: string;
  model?: string;
  meta?: PrinterModelMeta;
  battery?: string;
  labelsRemaining?: string;
  labelsTotal?: string;
  labelInfo?: string;
  connected: boolean;
}

export interface HaPrintRecord {
  at: string;
  copies: number;
  ok: boolean;
  error: string | null;
}

export interface HaLibraryEntry {
  id: string;
  name: string | null;
  saved: boolean;
  created: string;
  updated: string;
  prints: HaPrintRecord[];
  png?: string;
  width?: number;
  height?: number;
  density?: number;
  label_type?: number;
  rotate?: number;
  design?: ExportedLabelTemplate;
}

export interface HaEntryFields {
  name?: string | null;
  saved?: boolean;
  design?: ExportedLabelTemplate;
  png?: string;
  width?: number;
  height?: number;
  density?: number;
  label_type?: number;
  rotate?: number;
}

/** The logged-in `hass` object of the parent Home Assistant page, read fresh each time. */
const findHass = (): Hass | undefined => {
  try {
    if (window.parent === window) {
      return undefined;
    }
    const root = window.parent.document.querySelector("home-assistant") as (Element & { hass?: Hass }) | null;
    return root?.hass ?? undefined;
  } catch {
    // Cross-origin parent: not inside Home Assistant.
    return undefined;
  }
};

/** True when running inside the Home Assistant panel. Decided once at startup. */
export const haMode: boolean = findHass() !== undefined;

const call = async <T>(msg: Record<string, unknown>): Promise<T> => {
  const hass = findHass();
  if (hass === undefined) {
    throw new Error("Not running inside Home Assistant");
  }
  try {
    return await hass.connection.sendMessagePromise<T>(msg);
  } catch (e) {
    // HA rejects with {code, message}, not an Error.
    const err = e as { message?: string; code?: string };
    throw new Error(err?.message ?? err?.code ?? String(e));
  }
};

/** Drop undefined values; Home Assistant's schema rejects explicit nulls for numbers. */
const clean = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export const HaApi = {
  list: (savedOnly = false) =>
    call<{ entries: HaLibraryEntry[] }>({ type: "niimbot_designer/list", saved_only: savedOnly }),
  get: (entryId: string) => call<HaLibraryEntry>({ type: "niimbot_designer/get", entry_id: entryId }),
  save: (fields: HaEntryFields, entryId?: string) =>
    call<{ entry_id: string }>(clean({ type: "niimbot_designer/save", entry_id: entryId, ...fields })),
  remove: (entryId: string) => call<{ deleted: boolean }>({ type: "niimbot_designer/delete", entry_id: entryId }),
  print: (fields: HaEntryFields & { entry_id?: string; copies?: number; device_id?: string }) =>
    call<{ entry_id: string }>(clean({ type: "niimbot_designer/print", ...fields })),
};

/**
 * hass-niimbot rotates counter-clockwise (PIL). NiimBlue's "left" print direction means the
 * left edge of the design is printed first, i.e. the image turned 90 degrees clockwise.
 */
export const haRotation = (direction: PrintDirection): number => (direction === "left" ? 270 : 0);

/** A readable name for history: the template title, else the first text on the label. */
export const guessLabelName = (tpl?: ExportedLabelTemplate): string | undefined => {
  if (tpl?.title?.trim()) {
    return tpl.title.trim();
  }
  const objects = (tpl?.canvas as { objects?: { text?: unknown }[] } | undefined)?.objects ?? [];
  for (const o of objects) {
    if (typeof o.text === "string" && o.text.trim()) {
      return o.text.trim().replace(/\s+/g, " ").slice(0, 60);
    }
  }
  return undefined;
};

const readPrinters = (hass: Hass): HaPrinter[] => {
  const byDevice = new Map<string, string[]>();
  for (const reg of Object.values(hass.entities ?? {})) {
    if (reg.platform === "niimbot" && reg.device_id) {
      byDevice.set(reg.device_id, [...(byDevice.get(reg.device_id) ?? []), reg.entity_id]);
    }
  }

  return [...byDevice.entries()].map(([deviceId, entityIds]) => {
    const state = (suffix: string): string | undefined => {
      const id = entityIds.find((e) => e.endsWith(suffix));
      const s = id ? hass.states[id]?.state : undefined;
      return s === undefined || s === "unknown" || s === "unavailable" ? undefined : s;
    };
    const device = hass.devices?.[deviceId];
    const model = device?.model ?? undefined;
    return {
      deviceId,
      name: device?.name_by_user || device?.name || model || "NIIMBOT",
      model,
      meta: model ? getPrinterMetaByModel(model as PrinterModel) : undefined,
      battery: state("_battery"),
      labelsRemaining: state("_labels_remaining"),
      labelsTotal: state("_labels_total"),
      labelInfo: state("_cloud_label_info"),
      connected: state("_connectivity") === "on",
    };
  });
};

export const haPrinters = writable<HaPrinter[]>([]);
export const haSelectedPrinterId = writable<string | undefined>(undefined);

let pollTimer: ReturnType<typeof setInterval> | undefined;

/** Mirror the printers' HA sensors into stores and feed the selected model's specs to the editor. */
export const startHaPrinterSync = () => {
  if (!haMode || pollTimer !== undefined) {
    return;
  }

  const refresh = () => {
    const hass = findHass();
    if (hass === undefined) {
      return;
    }
    const printers = readPrinters(hass);
    haPrinters.set(printers);

    let selected = get(haSelectedPrinterId);
    if (!printers.some((p) => p.deviceId === selected)) {
      selected = printers[0]?.deviceId;
      haSelectedPrinterId.set(selected);
    }

    const meta = printers.find((p) => p.deviceId === selected)?.meta;
    if (get(printerMeta) !== meta) {
      printerMeta.set(meta);
    }
  };

  refresh();
  pollTimer = setInterval(refresh, 3000);
};
