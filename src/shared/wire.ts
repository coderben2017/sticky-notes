const WIRE_PREFIX = "base64-json-v1:";
const BYTE_CHUNK_SIZE = 0x8000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

declare const wireValueType: unique symbol;

export type WireValue<T> = string & {
  readonly [wireValueType]: T;
};

const bytesToBinary = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BYTE_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BYTE_CHUNK_SIZE));
  }
  return binary;
};

const binaryToBytes = (binary: string) => {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const encodeWireValue = <T>(value: T): WireValue<T> => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("RPC 数据无法序列化");

  const payload = btoa(bytesToBinary(encoder.encode(json)));
  return `${WIRE_PREFIX}${payload}` as WireValue<T>;
};

export const decodeWireValue = <T>(value: WireValue<T>): T => {
  if (!value.startsWith(WIRE_PREFIX)) throw new Error("RPC 数据编码格式无效");

  const payload = value.slice(WIRE_PREFIX.length);
  const json = decoder.decode(binaryToBytes(atob(payload)));
  return JSON.parse(json) as T;
};