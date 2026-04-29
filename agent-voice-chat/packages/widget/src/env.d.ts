declare const __VERSION__: string;

// Socket.IO is loaded dynamically — provide minimal type shim
declare module 'socket.io-client' {
  export function io(url: string, opts?: any): any;
}
