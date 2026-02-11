/**
 * Type declarations for libsodium-wrappers
 * These modules don't have complete type definitions
 */

declare module 'libsodium-wrappers' {
  interface LibsodiumWrappers {
    ready: Promise<void>;
    crypto_secretbox_easy(
      message: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ): Uint8Array;
    crypto_secretbox_open_easy(
      ciphertext: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ): Uint8Array;
    randombytes_buf(length: number): Uint8Array;
    [key: string]: any;
  }

  const sodium: LibsodiumWrappers;
  export default sodium;
}

declare module 'libsodium-wrappers-sumo' {
  interface LibsodiumWrappers {
    ready: Promise<void>;
    crypto_secretbox_easy(
      message: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ): Uint8Array;
    crypto_secretbox_open_easy(
      ciphertext: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ): Uint8Array;
    randombytes_buf(length: number): Uint8Array;
    [key: string]: any;
  }

  const sodium: LibsodiumWrappers;
  export default sodium;
}
