import { useEffect } from 'react'

/**
 * Declares the sheet this screen prints on, for as long as it is open.
 *
 * The P&L snapshot is a wide table and needs a landscape sheet, while every
 * other screen prints portrait. CSS has a tidy-looking way to say that — a
 * named page, `@page landscape { … }` with `page: landscape` on the one block
 * that wants it — and it is a trap.
 *
 * A page name is a page break. Where the name changes, the spec requires one,
 * so every box in the document that is *not* the snapshot belongs to the
 * unnamed page and is given a sheet of its own. Nothing has to be visible for
 * that to happen: an empty div appended to the end of <body> — which is what
 * a browser extension does to every page it is installed on — is enough to
 * produce a second page box with nothing on it. That is the blank page after
 * the statement, and why it appeared on the owner's machine and not on a
 * clean one. Measured in Chromium: the snapshot alone prints one page, and
 * one zero-height div after it prints two.
 *
 * So the screen that wants a different sheet asks for it for the whole
 * document, and the document only ever has one page name. The rule is taken
 * away again when the screen is left, so the next one prints on the
 * stylesheet's own sheet.
 */
export function usePrintPageSize(rule: string): void {
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.printPage = ''
    style.textContent = `@page { ${rule} }`
    document.head.append(style)
    return () => style.remove()
  }, [rule])
}
