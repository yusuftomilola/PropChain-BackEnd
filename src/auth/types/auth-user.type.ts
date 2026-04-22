export type AuthUserPayload = {
  sub: string;
  email: string;
  type: 'access' | 'refresh' | 'api-key';
  jti?: string;
  apiKeyId?: string;
};
