export async function compressAndEncode(data) {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(json);

  const compressedStream = new CompressionStream('gzip');
  const compressed = new Blob([uint8Array]).stream().pipeThrough(compressedStream);
  const compressedArrayBuffer = await new Response(compressed).arrayBuffer();
  const compressedUint8Array = new Uint8Array(compressedArrayBuffer);
  let base64 = btoa(String.fromCharCode(...compressedUint8Array));
  // Make base64 URL-safe:
  base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64;
}

export async function decodeAndDecompress(encoded) {
  // Reverse the URL-safe transformations:
  encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binaryString = atob(encoded);
  const len = binaryString.length;
  const uint8Array = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
  }

  const decompressedStream = new DecompressionStream('gzip');
  const decompressedBlob = new Blob([uint8Array]).stream().pipeThrough(decompressedStream);
  const decompressedArrayBuffer = await new Response(decompressedBlob).arrayBuffer();
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decompressedArrayBuffer));
}