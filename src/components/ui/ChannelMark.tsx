import { useDataStore } from '@/store/dataStore'
import { CHANNEL_LOGO_BOX, logoFor } from '@/data/channelLogos'
import { channelLabel } from '@/config/channels'
import type { BusinessChannelId } from '@/config/channels'

/**
 * A channel, shown as its own mark where one has been uploaded and as its name
 * where one has not.
 *
 * Every logo is drawn inside the same box and left to fit inside it. Marks
 * arrive at whatever size and shape the marketplace publishes them — a tall
 * square for one, a long wordmark for another — and letting each take its
 * natural size would make a row of channels look like a mistake rather than
 * like branding.
 */
export function ChannelMark({ channel, className }: { channel: BusinessChannelId; className?: string }) {
  const channelLogos = useDataStore((s) => s.channelLogos)
  const logo = logoFor(channelLogos, channel)
  const name = channelLabel(channel)

  if (!logo) return <span className={className}>{name}</span>

  return (
    <img
      src={logo.dataUrl}
      // The name is still the accessible label: a reader who cannot see the
      // mark needs the channel, not the word "logo".
      alt={name}
      className={className}
      style={{
        maxWidth: CHANNEL_LOGO_BOX.width,
        maxHeight: CHANNEL_LOGO_BOX.height,
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
      }}
    />
  )
}
