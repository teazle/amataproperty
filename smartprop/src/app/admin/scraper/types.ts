export interface AuthPlatformStatus {
  exists: boolean;
  isAuthenticated: boolean;
  isFresh: boolean;
  cookieCount: number;
  lastModified: string | null;
  lastAuth: string | null;
  stateAgeHours: number | null;
  failureReason: string | null;
}

export interface AuthStatus {
  propertyguru: AuthPlatformStatus;
  edgeprop: AuthPlatformStatus;
}
