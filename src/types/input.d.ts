declare module 'input' {
  const api: {
    text(prompt?: string): Promise<string>;
  };
  export default api;
}
