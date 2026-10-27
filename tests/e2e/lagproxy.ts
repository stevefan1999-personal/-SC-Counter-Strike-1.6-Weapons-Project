// A UDP proxy between one GoldSrc client and a server that holds every datagram for a fixed time in each direction, as
// a slow connection does, and counts the bytes and the reliable packets (netchan bit 31 of the first sequence word)
// that the server sends. tests/e2e/lag.ts puts the e2e client behind it.
import dgram from "node:dgram";
import { assert, assertEquals } from "@std/assert";

const LOOPBACK = "127.0.0.1";
const RELIABLE_BIT = 0x80000000;
const CONNECTIONLESS = 0xffffffff; // out-of-band packets (connect, info) carry no sequence
const SEQUENCE_BYTES = 4;

export type Traffic = { bytes: number; packets: number; reliablePackets: number; reliableBytes: number };

export class LagProxy {
  readonly #front = dgram.createSocket("udp4"); // the client sends here
  readonly #back = dgram.createSocket("udp4"); // and this socket talks to the server for it
  #client: { address: string; port: number } | undefined;
  #closed = false; // datagrams still on their way when the proxy closes are dropped
  // What the server sent since the last take().
  #traffic: Traffic = { bytes: 0, packets: 0, reliablePackets: 0, reliableBytes: 0 };

  private constructor(readonly serverPort: number, readonly delayMs: number) {}

  // Listens on a free loopback port; `port` is the one the client must connect to.
  static async open(serverPort: number, delayMs: number): Promise<LagProxy & { port: number }> {
    const proxy = new LagProxy(serverPort, delayMs);
    await Promise.all(
      [proxy.#front, proxy.#back].map((socket) => new Promise<void>((resolve) => socket.bind(0, LOOPBACK, resolve))),
    );
    proxy.#front.on("message", (data, from) => {
      proxy.#client = { address: from.address, port: from.port };
      proxy.#later(() => proxy.#back.send(data, serverPort, LOOPBACK));
    });
    proxy.#back.on("message", (data) => {
      proxy.#count(data);
      const client = proxy.#client;
      if (client) proxy.#later(() => proxy.#front.send(data, client.port, client.address));
    });
    return Object.assign(proxy, { port: proxy.#front.address().port });
  }

  // The server's traffic since the last call.
  take(): Traffic {
    const traffic = this.#traffic;
    this.#traffic = { bytes: 0, packets: 0, reliablePackets: 0, reliableBytes: 0 };
    return traffic;
  }

  close() {
    this.#closed = true;
    this.#front.close();
    this.#back.close();
  }

  #later(send: () => void) {
    setTimeout(() => this.#closed || send(), this.delayMs);
  }

  #count(data: Uint8Array) {
    this.#traffic.bytes += data.length;
    this.#traffic.packets++;
    if (data.length < SEQUENCE_BYTES) return;
    const sequence = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
    if (sequence !== CONNECTIONLESS && (sequence & RELIABLE_BIT) !== 0) {
      this.#traffic.reliablePackets++;
      this.#traffic.reliableBytes += data.length;
    }
  }
}

Deno.test("the proxy delays both directions and counts the server's reliable packets", async () => {
  const delayMs = 60;
  const server = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => server.bind(0, LOOPBACK, resolve));
  // The fake server answers each datagram with a reliable packet: sequence 1 with bit 31 set.
  server.on("message", (_data, from) => {
    const reply = new Uint8Array(SEQUENCE_BYTES * 2);
    new DataView(reply.buffer).setUint32(0, RELIABLE_BIT | 1, true);
    server.send(reply, from.port, from.address);
  });
  const proxy = await LagProxy.open(server.address().port, delayMs);
  const client = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => client.bind(0, LOOPBACK, resolve));
  try {
    const answered = new Promise<number>((resolve) => client.once("message", () => resolve(performance.now())));
    const sent = performance.now();
    client.send(new Uint8Array([1, 2, 3, 4]), proxy.port, LOOPBACK);
    const roundTrip = await answered - sent;
    assert(roundTrip >= 2 * delayMs, `round trip ${roundTrip} ms is shorter than two delays`);
    assertEquals(proxy.take(), { bytes: 8, packets: 1, reliablePackets: 1, reliableBytes: 8 });
  } finally {
    client.close();
    proxy.close();
    server.close();
  }
});
