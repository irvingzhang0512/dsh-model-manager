import { deflateSync } from 'node:zlib'

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, 'ascii')
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([length, type, data, checksum])
}

/** 固定 8×8 红色 PNG，用于可核对的图片能力验证。 */
export function probePng(): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4)
  header[8] = 8; header[9] = 6
  const row = Buffer.alloc(1 + 8 * 4)
  for (let x = 0; x < 8; x++) { const index = 1 + x * 4; row[index] = 255; row[index + 3] = 255 }
  const pixels = Buffer.concat(Array.from({ length: 8 }, () => row))
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ])
}
