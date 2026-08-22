// Produces file names like HLPL_Meesho_08-26_V2 — hyphens instead of `/`
// (unsafe in file names on many OSes) and an auto-incrementing version that
// never overwrites a prior export. The counter persists in localStorage so
// repeat downloads within a browser session keep incrementing correctly.

const STORAGE_KEY = 'hlpl_download_versions'

function readVersions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeVersions(versions: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(versions))
  } catch {
    // localStorage unavailable (e.g. private browsing) — versioning degrades
    // to always "V1" for the session, which is still a safe, non-overwriting name.
  }
}

/** monthYear must be "MM-YY", e.g. "08-26". */
export function nextDownloadFileName(context: string, monthYear: string): string {
  const key = `${context}_${monthYear}`
  const versions = readVersions()
  const nextVersion = (versions[key] ?? 0) + 1
  versions[key] = nextVersion
  writeVersions(versions)
  return `HLPL_${context}_${monthYear}_V${nextVersion}`
}

/** Converts a yyyy-mm key to the MM-YY format used in download file names. */
export function toMonthYearSuffix(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-')
  return `${m}-${y.slice(2)}`
}
