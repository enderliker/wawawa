import fs from 'node:fs';
import path from 'node:path';

export type GuildSettings = {
  recordingEnabled?: boolean;
  mode247Enabled?: boolean;
};

type SettingsFile = Record<string, GuildSettings>;

// Exported so other modules (e.g. IA command) can share the same data directory.
export const DATA_DIR = process.env.DATA_DIR || '/home/container/data';
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

function ensureDir(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export function readAllSettings(): SettingsFile {
  ensureDir();
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as SettingsFile;
  } catch {
    // ignore
  }
  return {};
}

export function writeAllSettings(data: SettingsFile): void {
  ensureDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function getGuildSettings(guildId: string): GuildSettings {
  const all = readAllSettings();
  return all[guildId] ?? {};
}

export function setGuildSettings(guildId: string, patch: GuildSettings): GuildSettings {
  const all = readAllSettings();
  const next: GuildSettings = { ...(all[guildId] ?? {}), ...patch };
  all[guildId] = next;
  writeAllSettings(all);
  return next;
}

export function getRecordingEnabled(guildId: string): boolean {
  return Boolean(getGuildSettings(guildId).recordingEnabled);
}

export function setRecordingEnabled(guildId: string, enabled: boolean): void {
  setGuildSettings(guildId, { recordingEnabled: enabled });
}

export function get247Enabled(guildId: string): boolean {
  return Boolean(getGuildSettings(guildId).mode247Enabled);
}

export function set247Enabled(guildId: string, enabled: boolean): void {
  setGuildSettings(guildId, { mode247Enabled: enabled });
}
