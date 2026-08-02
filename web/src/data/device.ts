import { uuidv7 } from "./uuidv7";

const DEVICE_ID_KEY = "itp-itr-device-id";

/**
 * A stable per-device identifier, part of the on-device signing evidence
 * (SPEC §6 path A: "device id"). Generated once and persisted in localStorage;
 * it is not a user identity and carries no personal data. If storage is
 * unavailable, a volatile id is returned so signing still works.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = uuidv7();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return uuidv7();
  }
}
