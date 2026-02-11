/**
 * Type declarations for gtts package
 */

declare module 'gtts' {
  import { Readable } from 'node:stream';

  class gtts {
    constructor(lang: string);
    stream(text: string, callback: (err: Error | null, stream: Readable) => void): void;
    save(filename: string, text: string, callback: (err: Error | null) => void): void;
  }

  export = gtts;
}
