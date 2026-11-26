// =============================================================================
// WebSocket — the server half of RFC 6455, and no more
// =============================================================================
//
// Node ships a WebSocket *client* (undici) and no server. The usual answer is the `ws`
// package; this one exists because the extension has zero runtime dependencies and the
// server it talks to should not be where that stops — this process runs on the reviewer's
// machine with the reviewer's notes in memory, and every package in it is one more thing
// to trust.
//
// The peer is known: Chrome's own WebSocket implementation. So this handles what a
// conforming client sends — masked frames, text messages, fragmentation, ping, close —
// and refuses everything else (binary frames, unmasked frames, extensions) by closing,
// which is what the RFC asks of a server that receives something it does not support.
// =============================================================================

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Close codes used here. 1002 protocol error, 1003 unsupported data, 1009 too big. */
const CLOSE_NORMAL = 1000;
const CLOSE_PROTOCOL = 1002;
const CLOSE_UNSUPPORTED = 1003;
const CLOSE_TOO_BIG = 1009;

export class WebSocketConnection {
  onMessage: (text: string) => void = () => {};
  onClose: () => void = () => {};

  /**
   * Received bytes not yet parsed, as the chunks they arrived in.
   *
   * Concatenated only once enough bytes are buffered to finish the frame being waited
   * for. A snapshot with embedded screenshots is megabytes, arrives in 64 KB chunks, and
   * concatenating on every chunk would copy it a hundred times over.
   */
  private chunks: Buffer[] = [];
  private buffered = 0;
  /** Bytes the current frame needs in total; 0 while the header is still unread. */
  private needed = 0;

  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private fragmenting = false;
  private closed = false;

  constructor(
    private readonly socket: Duplex,
    private readonly maxMessageBytes: number,
  ) {
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  send(text: string): void {
    if (this.closed) return;
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, "utf8")));
  }

  close(code = CLOSE_NORMAL): void {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.socket.write(encodeFrame(OP_CLOSE, payload));
    this.socket.end();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.chunks = [];
    this.fragments = [];
    this.socket.destroy();
    this.onClose();
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    this.drain();
  }

  private drain(): void {
    while (!this.closed) {
      if (this.needed && this.buffered < this.needed) return;
      if (this.buffered < 2) return;

      const buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.buffered);
      this.chunks = [buffer];

      const frame = parseHeader(buffer);
      if (frame === "incomplete") return;
      if (frame === "unmasked") return this.close(CLOSE_PROTOCOL);
      if (frame.length > this.maxMessageBytes) return this.close(CLOSE_TOO_BIG);

      const total = frame.offset + frame.length;
      if (buffer.length < total) {
        this.needed = total;
        return;
      }

      const payload = Buffer.from(buffer.subarray(frame.offset, total));
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= frame.mask[index & 3];
      }

      const rest = buffer.subarray(total);
      this.chunks = rest.length ? [rest] : [];
      this.buffered = rest.length;
      this.needed = 0;

      this.handle(frame.fin, frame.opcode, payload);
    }
  }

  private handle(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OP_TEXT:
      case OP_CONTINUATION: {
        if (opcode === OP_TEXT && this.fragmenting) return this.close(CLOSE_PROTOCOL);
        if (opcode === OP_CONTINUATION && !this.fragmenting) return this.close(CLOSE_PROTOCOL);

        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > this.maxMessageBytes) return this.close(CLOSE_TOO_BIG);
        this.fragments.push(payload);
        this.fragmenting = !fin;
        if (!fin) return;

        const message = Buffer.concat(this.fragments, this.fragmentBytes).toString("utf8");
        this.fragments = [];
        this.fragmentBytes = 0;
        this.onMessage(message);
        return;
      }
      case OP_PING:
        if (!this.closed) this.socket.write(encodeFrame(OP_PONG, payload));
        return;
      case OP_PONG:
        return;
      case OP_CLOSE:
        return this.close(CLOSE_NORMAL);
      case OP_BINARY:
        return this.close(CLOSE_UNSUPPORTED);
      default:
        return this.close(CLOSE_PROTOCOL);
    }
  }
}

type Header = { fin: boolean; opcode: number; length: number; offset: number; mask: Buffer };

function parseHeader(buffer: Buffer): Header | "incomplete" | "unmasked" {
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < 4) return "incomplete";
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return "incomplete";
    const big = buffer.readBigUInt64BE(2);
    // Anything past 2^53 is far past every cap anyway; clamp so the caller's size check
    // sees a number that compares correctly instead of a rounded one.
    length = big > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(big);
    offset = 10;
  }

  // Every client frame must be masked (RFC 6455 §5.1). A peer that does not mask is not
  // a browser, and the server is required to close on it.
  if (!masked) return "unmasked";
  if (buffer.length < offset + 4) return "incomplete";
  return { fin, opcode, length, offset: offset + 4, mask: buffer.subarray(offset, offset + 4) };
}

/** Server frames are never masked, and are always sent whole. */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Complete the opening handshake, or say why not.
 *
 * Only the mechanics live here; *who* may connect is the caller's decision, made before
 * this is called (`hub.ts` checks `Host` and `Origin`).
 */
export function acceptUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  maxMessageBytes: number,
): WebSocketConnection | null {
  const key = request.headers["sec-websocket-key"];
  const version = request.headers["sec-websocket-version"];
  const upgrade = String(request.headers.upgrade ?? "").toLowerCase();

  if (upgrade !== "websocket" || typeof key !== "string" || version !== "13") {
    refuseUpgrade(socket, 400, "Bad Request");
    return null;
  }

  const accept = createHash("sha1").update(key + ACCEPT_GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  // Bytes that arrived in the same packet as the handshake are handed to the `upgrade`
  // listener rather than the stream. Put back before the connection starts listening,
  // they are read as the first frame like any other.
  if (head.length) socket.unshift(head);
  return new WebSocketConnection(socket, maxMessageBytes);
}

export function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
