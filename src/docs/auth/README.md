# Auth & Users

Documentation for the internal authentication and user-management flows of OpenFusionAPI.

- [User Management & Password Recovery](./USER_RECOVERY.md): user CRUD, self-service password
  change, admin password reset, and the OTP password-recovery flow delivered by email and/or
  Telegram, including configuration AppVars and the Telegram Recovery bot.
- Flow diagrams of the authentication and recovery pipelines (human reference):
  [../flows/AUTH.md](../flows/AUTH.md).
- Security certificate including the brute-force authentication rate limiter:
  [../security/SECURITY_CERTIFICATE.md](../security/SECURITY_CERTIFICATE.md).