/** Short, human description of a browser from its user-agent string, e.g. "iPhone · Safari". */
export function describeDevice(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s) return "Unknown device";
  const device = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? (/Mobile/.test(s) ? "Android phone" : "Android tablet") : /Windows/.test(s) ? "Windows PC" : /Macintosh|Mac OS X/.test(s) ? "Mac" : /CrOS/.test(s) ? "Chromebook" : /Linux/.test(s) ? "Linux PC" : "Unknown device";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "browser";
  return `${device} · ${browser}`;
}
