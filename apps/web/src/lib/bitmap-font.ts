/**
 * Classic 5×7 bitmap font (printable ASCII 0x20–0x7E), one byte per column, bit 0 = top row. Used to
 * burn text into images WITHOUT system fonts: the runtime image (node:alpine, ADR 0002) has no
 * fontconfig fonts, so SVG `<text>` / sharp `text` would render nothing (D7 selfie stamp).
 */
const GLYPHS =
  '0000000000' + '00005f0000' + '0007000700' + '147f147f14' + '242a7f2a12' + '2313086462' + '3649552250' + '0005030000' +
  '001c224100' + '0041221c00' + '082a1c2a08' + '08083e0808' + '0050300000' + '0808080808' + '0060600000' + '2010080402' +
  '3e5149453e' + '00427f4000' + '4261514946' + '2141454b31' + '1814127f10' + '2745454539' + '3c4a494930' + '0171090503' +
  '3649494936' + '064949291e' + '0036360000' + '0056360000' + '0008142241' + '1414141414' + '4122140800' + '0201510906' +
  '324979413e' + '7e1111117e' + '7f49494936' + '3e41414122' + '7f4141221c' + '7f49494941' + '7f09090101' + '3e41415132' +
  '7f0808087f' + '00417f4100' + '2040413f01' + '7f08142241' + '7f40404040' + '7f0204027f' + '7f0408107f' + '3e4141413e' +
  '7f09090906' + '3e4151215e' + '7f09192946' + '4649494931' + '01017f0101' + '3f4040403f' + '1f2040201f' + '7f2018207f' +
  '6314081463' + '0304780403' + '6151494543' + '00007f4141' + '0204081020' + '41417f0000' + '0402010204' + '4040404040' +
  '0001020400' + '2054545478' + '7f48444438' + '3844444420' + '384444487f' + '3854545418' + '087e090102' + '081454543c' +
  '7f08040478' + '00447d4000' + '2040443d00' + '007f102844' + '00417f4000' + '7c04180478' + '7c08040478' + '3844444438' +
  '7c14141408' + '081414187c' + '7c08040408' + '4854545420' + '043f444020' + '3c4040207c' + '1c2040201c' + '3c4030403c' +
  '4428102844' + '0c5050503c' + '4464544c44' + '0008364100' + '00007f0000' + '0041360800' + '0201020402'

export const GLYPH_W = 5
export const GLYPH_H = 7

/** Column bytes of a printable ASCII character (anything else → '?'). */
export function glyph(ch: string): number[] {
  let code = ch.charCodeAt(0)
  if (!(code >= 0x20 && code <= 0x7e)) code = 0x3f
  const at = (code - 0x20) * 10
  const out: number[] = []
  for (let i = 0; i < GLYPH_W; i++) out.push(parseInt(GLYPHS.slice(at + i * 2, at + i * 2 + 2), 16))
  return out
}

/** Text the font can draw: diacritics stripped, a few symbols spelled out, the rest → '?'. */
export function toAscii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[·•–—]/g, '-')
    .replace(/±/g, '+/-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, '?')
}

/**
 * Draws `text` into an RGBA buffer (`width` px per row) at (x, y), each font pixel a `scale`×`scale`
 * square of `rgba`. Pixels outside the buffer are skipped. Returns the advance width in px.
 */
export function drawText(buf: Buffer, width: number, height: number, x: number, y: number, text: string, scale: number, rgba: readonly [number, number, number, number]): number {
  const adv = (GLYPH_W + 1) * scale
  let cx = x
  for (const ch of toAscii(text)) {
    const cols = glyph(ch)
    for (let c = 0; c < GLYPH_W; c++) {
      for (let r = 0; r < GLYPH_H; r++) {
        if (((cols[c] ?? 0) >> r) & 1) {
          for (let dy = 0; dy < scale; dy++) {
            const py = y + r * scale + dy
            if (py < 0 || py >= height) continue
            for (let dx = 0; dx < scale; dx++) {
              const px = cx + c * scale + dx
              if (px < 0 || px >= width) continue
              const o = (py * width + px) * 4
              buf[o] = rgba[0]
              buf[o + 1] = rgba[1]
              buf[o + 2] = rgba[2]
              buf[o + 3] = rgba[3]
            }
          }
        }
      }
    }
    cx += adv
  }
  return cx - x
}

/** Width in px of `text` at `scale`. */
export const textWidth = (text: string, scale: number): number => toAscii(text).length * (GLYPH_W + 1) * scale
