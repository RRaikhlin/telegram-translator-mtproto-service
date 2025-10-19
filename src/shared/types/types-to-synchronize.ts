//subscribe
export type SubscribeRpcResponse = {
  ok: true;
  channel: { tgId: string; username?: string; title?: string };
};

//unsubscribe
export type UnsubscribeRpcResponse = {
  left: boolean;
  kind: 'channel' | 'megagroup' | 'chat' | 'user';
};
