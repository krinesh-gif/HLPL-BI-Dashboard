/**
 * The text of a PDF, for the documents that arrive as one.
 *
 * Nykaa's Marketing Invest bill is emailed as a PDF every month and is the
 * only way that cost reaches the business, so it has to be readable here
 * rather than retyped.
 *
 * pdf.js is imported on demand. It is by far the largest dependency in the
 * app, and loading it into every session so that one screen can read one
 * invoice a month would make every other page slower to open.
 */
export async function readPdfText(file: File): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    // pdf.js refuses to parse anything in a browser without a worker — the
    // `disableWorker` option is honoured only by its Node build. Vite emits
    // the worker as its own asset and hands back the URL, so it is fetched
    // once, alongside the library, and only on the upload screen.
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    // Not in pdf.js's published parameter type, but honoured: an invoice is
    // data, and nothing in it should ever be executed.
    ...({ isEvalSupported: false } as Record<string, boolean>),
  }).promise

  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' '),
    )
  }
  await doc.cleanup()
  return pages.join('\n')
}
