// Eroeffnungsbuch: alle Stellungen mit genau `ply` Steinen, die die Suche erreichen kann,
// mit ihrem exakten Score. Wird einmal offline gerechnet (tools/build-book.js) und danach
// nur noch nachgeschlagen - damit ueberspringt die Suche die teuersten ersten Halbzuege.
//
// Ablage als offen adressierte Hashtabelle mit linearer Sondierung, gleiche Packung wie die
// Transpositionstabelle: zwei 32-Bit-Woerter je Eintrag, also eine Cache-Zeile.
//   Wort 0: kLo (32 Bit)
//   Wort 1: kHi (Bit 0-16) | Score+32 (17-22)
// Ein leerer Platz ist 0; das ist eindeutig, weil Score+32 nie 0 wird (Score >= -20).

const HI_MASK = 0x1ffff
const BIAS = 32
const MAGIC = 0x43463442 // "CF4B"

const slot = (kLo, kHi, mask) => ((Math.imul(kLo, 0x9e3779b1) ^ Math.imul(kHi, 0x85ebca77)) & mask)

export const createBook = (ply, count) => {
  // Fuellgrad hoechstens 50 Prozent, sonst leidet die lineare Sondierung
  let bits = 1
  while ((1 << bits) < count * 2) bits++
  return { ply, mask: (1 << bits) - 1, count: 0, words: new Uint32Array((1 << bits) * 2) }
}

export const putBook = (book, kLo, kHi, score) => {
  const { words, mask } = book
  let i = slot(kLo, kHi, mask)
  while (words[(i << 1) + 1] !== 0) {
    if (words[i << 1] === (kLo >>> 0) && (words[(i << 1) + 1] & HI_MASK) === (kHi >>> 0)) return // schon drin
    i = (i + 1) & mask
  }
  words[i << 1] = kLo
  words[(i << 1) + 1] = (kHi & HI_MASK) | ((score + BIAS) << 17)
  book.count++
}

export const lookupBook = (book, kLo, kHi) => {
  const { words, mask } = book
  let i = slot(kLo, kHi, mask)
  for (;;) {
    const w = words[(i << 1) + 1]
    if (w === 0) return undefined
    if (words[i << 1] === (kLo >>> 0) && (w & HI_MASK) === (kHi >>> 0)) return ((w >>> 17) & 63) - BIAS
    i = (i + 1) & mask
  }
}

export const serializeBook = (book) => {
  const header = new Uint32Array([MAGIC, book.ply, book.mask, book.count])
  const bytes = new Uint8Array(header.byteLength + book.words.byteLength)
  bytes.set(new Uint8Array(header.buffer), 0)
  bytes.set(new Uint8Array(book.words.buffer), header.byteLength)
  return bytes
}

export const deserializeBook = (bytes) => {
  const view = new Uint8Array(bytes)
  const header = new Uint32Array(view.slice(0, 16).buffer)
  if (header[0] !== MAGIC) throw new Error('Kein gueltiges Eroeffnungsbuch')
  const mask = header[2]
  const words = new Uint32Array(view.slice(16).buffer, 0, (mask + 1) * 2)
  return { ply: header[1], mask, count: header[3], words }
}
