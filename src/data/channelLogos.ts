import type { BusinessChannelId } from '@/config/channels'

/**
 * A marketplace's own mark, uploaded once and shown wherever the channel is
 * named.
 *
 * Optional by design. A channel with no logo shows its name, which is what
 * every channel did before this existed and is a perfectly good label — the
 * logo is recognition at a glance, not a requirement.
 */
export interface ChannelLogo {
  channel: BusinessChannelId
  /** The scaled-down image, as a data URL. */
  dataUrl: string
  /** What the uploaded file was called, so the settings row can say which
   * image is in place without rendering it twice. */
  fileName: string
  updatedAt?: string
}

/** The box a logo is drawn in, in CSS pixels. Every mark gets the same one:
 * a row of channel names where one logo is twice the height of the next reads
 * as a mistake rather than as branding. */
export const CHANNEL_LOGO_BOX = { width: 104, height: 28 } as const

/**
 * What is stored: the image redrawn to fit twice the display box.
 *
 * Twice, so it stays sharp on a retina screen; no larger, because a logo shown
 * at 28px tall has no business weighing more than the page around it. Scaling
 * here rather than on the server means the upload is already small — the
 * alternative is posting whatever came off someone's desktop and hoping.
 *
 * An SVG is passed through untouched. It is already resolution-independent,
 * and drawing it to a canvas would turn the one format that never blurs into
 * one that does.
 */
export async function prepareLogoForUpload(file: File): Promise<string> {
  const asText = await file.text().catch(() => '')
  if (file.type === 'image/svg+xml') {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(asText)))}`
  }

  const bitmap = await createImageBitmap(file)
  const maxW = CHANNEL_LOGO_BOX.width * 2
  const maxH = CHANNEL_LOGO_BOX.height * 2
  const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not read the image.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  // PNG, so a logo on a transparent background stays on one. Re-encoding a
  // photograph this way would be wasteful, but a logo is flat colour and
  // compresses better as PNG than it would as JPEG.
  return canvas.toDataURL('image/png')
}

/** The logo for a channel, or null when none has been uploaded. */
export function logoFor(logos: ChannelLogo[], channel: BusinessChannelId): ChannelLogo | null {
  return logos.find((l) => l.channel === channel) ?? null
}
