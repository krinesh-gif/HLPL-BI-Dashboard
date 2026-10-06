/**
 * Just enough ZIP to open a Blinkit payout archive.
 *
 * Blinkit publishes a month as a folder of six workbooks inside one zip, and
 * that zip is what the owner downloads and uploads. Asking him to extract it
 * first would be asking him to do by hand, every month, the one step a
 * computer is good at — and six loose workbooks with names like
 * "E. Other_deductions_charges.xlsx" are easy to upload incompletely.
 *
 * Written here rather than taken from a library because the whole of what is
 * needed is below: read the central directory, and decompress two methods.
 * The alternative was a dependency in a bundle already over 500 kB.
 *
 * Deliberately not a general ZIP implementation. It refuses what it cannot
 * read rather than guessing: encrypted entries, methods other than store and
 * deflate, and ZIP64 archives all throw with a sentence that says what to do.
 */

export interface ZipEntry {
  /** Full path inside the archive, folders included. */
  path: string
  bytes: Uint8Array
}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_ZIP64_EOCD = 0x06064b50
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/**
 * Entries, read from the central directory rather than by walking local
 * headers.
 *
 * The central directory is the authority: Blinkit's own archive writes zero
 * into the compressed and uncompressed size fields of every local header,
 * which is legal and which defeats a reader that walks the file forwards.
 * That is not an edge case to guard against — it is this archive, every month.
 */
export async function unzip(data: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const eocd = findEndOfCentralDirectory(buf, view)
  let count = view.getUint16(eocd + 10, true)
  let directoryAt = view.getUint32(eocd + 16, true)
  // 0xffff / 0xffffffff in the end record means the real values are in a
  // ZIP64 record. Rather than half-support it, say so.
  if (count === 0xffff || directoryAt === 0xffffffff) {
    throw new Error('This zip is in ZIP64 format, which this reader does not support. Extract it and upload the workbooks instead.')
  }
  if (view.getUint32(eocd - 20 >= 0 ? eocd - 20 : 0, true) === SIG_ZIP64_EOCD) {
    throw new Error('This zip is in ZIP64 format, which this reader does not support. Extract it and upload the workbooks instead.')
  }

  const entries: ZipEntry[] = []
  let at = directoryAt
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || view.getUint32(at, true) !== SIG_CENTRAL) {
      throw new Error('This zip file is damaged — its index does not match its contents. Download it from Blinkit again.')
    }
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const uncompressedSize = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localAt = view.getUint32(at + 42, true)
    const path = decodeName(buf.subarray(at + 46, at + 46 + nameLength), flags)
    at += 46 + nameLength + extraLength + commentLength

    // A folder entry, not a file. Carries no data and is not worth reporting.
    if (path.endsWith('/')) continue
    if (flags & 0x0001) throw new Error(`"${path}" is encrypted, so it cannot be read. Upload an archive without a password.`)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('This zip is in ZIP64 format, which this reader does not support. Extract it and upload the workbooks instead.')
    }

    // The local header's own name and extra fields have their own lengths,
    // which differ from the central directory's. Reading the central
    // directory's lengths here is the classic way to land mid-file.
    const localNameLength = view.getUint16(localAt + 26, true)
    const localExtraLength = view.getUint16(localAt + 28, true)
    const dataAt = localAt + 30 + localNameLength + localExtraLength
    const raw = buf.subarray(dataAt, dataAt + compressedSize)

    if (method === METHOD_STORE) {
      entries.push({ path, bytes: raw })
    } else if (method === METHOD_DEFLATE) {
      entries.push({ path, bytes: await inflateRaw(raw) })
    } else {
      throw new Error(`"${path}" uses an unsupported compression method (${method}). Extract the zip and upload the workbooks instead.`)
    }
  }
  return entries
}

/**
 * The end-of-central-directory record, found by scanning backwards.
 *
 * Its signature can also occur inside a trailing comment, so the candidate is
 * only accepted when the comment length it declares reaches exactly the end of
 * the file.
 */
function findEndOfCentralDirectory(buf: Uint8Array, view: DataView): number {
  const earliest = Math.max(0, buf.length - 0xffff - 22)
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue
    if (i + 22 + view.getUint16(i + 20, true) === buf.length) return i
  }
  throw new Error('This file is not a zip archive.')
}

/** Bit 11 set means the name is UTF-8. Otherwise it is CP437, of which the
 * ASCII range is all a Blinkit file name uses. */
function decodeName(bytes: Uint8Array, flags: number): string {
  return new TextDecoder(flags & 0x0800 ? 'utf-8' : 'ascii').decode(bytes)
}

/** Raw deflate, via the stream the platform already has. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress zip files. Extract the zip and upload the workbooks instead.')
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
