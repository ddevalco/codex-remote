export interface WsClient {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}
