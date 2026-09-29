"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const WIDTH = 1280;
const HEIGHT = 720;
const OUTPUT_DIRECTORY = path.join(__dirname, "generated");

const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[value] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createBinaryPng(blackProbability, seed) {
  const random = mulberry32(seed);
  const stride = 1 + WIDTH * 4;
  const pixels = Buffer.allocUnsafe(stride * HEIGHT);

  for (let y = 0; y < HEIGHT; y += 1) {
    const rowStart = y * stride;
    pixels[rowStart] = 0;

    for (let x = 0; x < WIDTH; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const color = random() < blackProbability ? 0 : 255;
      pixels[offset] = color;
      pixels[offset + 1] = color;
      pixels[offset + 2] = color;
      pixels[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const images = [
  { percentage: 0, seed: 0x00a0b0c0 },
  { percentage: 10, seed: 0x10a0b0c0 },
  { percentage: 50, seed: 0x50a0b0c0 },
  { percentage: 90, seed: 0x90a0b0c0 }, 
  {percentage: 100, seed: 0xf0a0b0c0}
];

fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

for (const image of images) {
  const fileName = `bw-${image.percentage}-percent.png`;
  const filePath = path.join(OUTPUT_DIRECTORY, fileName);
  const png = createBinaryPng(image.percentage / 100, image.seed);
  fs.writeFileSync(filePath, png);
  console.log(`Generada: ${path.relative(__dirname, filePath)}`);
}
