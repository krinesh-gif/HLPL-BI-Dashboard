import { useRef, useState } from 'react'
import { BUSINESS_CHANNELS } from '@/config/channels'
import type { BusinessChannelId } from '@/config/channels'
import { CHANNEL_LOGO_BOX, logoFor } from '@/data/channelLogos'
import { useDataStore } from '@/store/dataStore'

/**
 * A logo per marketplace, uploaded once.
 *
 * A channel without one shows its name, which is what every channel did before
 * this existed — the logo is recognition at a glance, not a requirement, and
 * nothing is blocked by leaving a row empty.
 */
export function ChannelLogoSettings() {
  const { channelLogos, saveChannelLogo, removeChannelLogo } = useDataStore()
  const [busy, setBusy] = useState<BusinessChannelId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef<Partial<Record<BusinessChannelId, HTMLInputElement | null>>>({})

  async function upload(channel: BusinessChannelId, file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(channel)
    setError(null)
    try {
      await saveChannelLogo(channel, file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be read.')
    } finally {
      setBusy(null)
      // Clearing the picker lets the same file be chosen again after a failure;
      // without it the browser reports no change and nothing happens.
      const input = inputs.current[channel]
      if (input) input.value = ''
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink)]">Channel logos</h3>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        Shown wherever a channel is named. A channel with no logo shows its name instead. Every mark is drawn in the
        same {CHANNEL_LOGO_BOX.width}×{CHANNEL_LOGO_BOX.height} box, so one cannot end up larger than the next.
      </p>

      {error && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] px-3.5 py-2.5 text-sm text-[var(--critical-ink)]">
          {error}
        </p>
      )}

      <ul className="mt-4 divide-y divide-[var(--line)]">
        {BUSINESS_CHANNELS.map((channel) => {
          const logo = logoFor(channelLogos, channel.id)
          return (
            <li key={channel.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                {/* The box is drawn whether or not it holds anything, so the
                    rows line up and the size a logo gets is visible before one
                    is chosen. */}
                <span
                  className="flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-[var(--line-2)] bg-[var(--surface-2)]"
                  style={{ width: CHANNEL_LOGO_BOX.width + 16, height: CHANNEL_LOGO_BOX.height + 16 }}
                >
                  {logo ? (
                    <img
                      src={logo.dataUrl}
                      alt={channel.label}
                      style={{
                        maxWidth: CHANNEL_LOGO_BOX.width,
                        maxHeight: CHANNEL_LOGO_BOX.height,
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <span className="text-[11px] text-[var(--ink-3)]">No logo</span>
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink)]">{channel.label}</div>
                  <div className="truncate text-xs text-[var(--ink-3)]">
                    {logo ? logo.fileName || 'Uploaded' : 'Showing the name'}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <label
                  className={`cursor-pointer rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] ${
                    busy === channel.id ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  <input
                    ref={(el) => { inputs.current[channel.id] = el }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    onChange={(e) => void upload(channel.id, e.target.files?.[0])}
                  />
                  {busy === channel.id ? 'Uploading…' : logo ? 'Replace' : 'Upload a logo'}
                </label>
                {logo && (
                  <button
                    type="button"
                    onClick={() => void removeChannelLogo(channel.id)}
                    className="rounded-[var(--radius-control)] px-2.5 py-2 text-xs font-medium text-[var(--ink-3)] transition-colors hover:text-[var(--critical-ink)]"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
