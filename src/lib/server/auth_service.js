import { login, getUserById } from "../db/user.js";
import { getUserPasswordTokenFromRequest } from "./auth.js";
import { hasPermission, actionFromMethod } from "./permissions.js";
import { resolveResource } from "./resourceMapper.js";

export class AuthService {
  /**
   * Evaluates Bearer-based authorization.
   *
   * Priority for an internal user:
   *   1. as_admin bypass
   *   2. self-service endpoints (changepassword, linktelegram)
   *   3. endpoint.ctrl.users allowlist (when non-empty)
   *   4. endpoint.ctrl.authenticated ("any valid session")
   *   5. ctrl.env[environment][resource][action]
   *   6. deny (fail-closed)
   *
   * An ApiKey token is granted when its idapp matches the endpoint's idapp.
   */
  static async check_auth_Bearer(handler, data_aut) {
    let check = false;

    // ── ApiKey path ──
    if (data_aut?.Bearer?.data?.apikey?.idapp == handler.params.idapp) {
      check = true;
    } else if (data_aut?.Bearer?.data?.admin && handler.params) {
      const tokenUser = data_aut.Bearer.data.admin;

      // For system endpoints re-read the user from the DB on every request so
      // permission changes (as_admin / ctrl.env) take effect immediately and
      // not only at the next login. If the user no longer exists or was
      // disabled → deny.
      let user = tokenUser;
      if (handler.params.app === "system") {
        const fresh = await AuthService.freshUser(tokenUser);
        if (!fresh) return false;
        if (fresh.enabled === false) return false;
        user = fresh;
      }

      const userCtrl = user.ctrl || {};

      // as_admin — global bypass (backward-compatible). Checked before the
      // per-endpoint allowlist so a superadmin is never locked out of an
      // endpoint that restricts itself to a list of users.
      if (userCtrl.as_admin === true) {
        return true;
      }

      // Self-service password change (`/user/changepassword`): any user with a
      // valid session may change their own password. Access control here is the
      // current-password validation performed by `updateUserPassword` (old
      // password must match), NOT the generic `users:<action>` resource
      // permission — otherwise users with an empty/limited ctrl cannot comply
      // with a forced password change on first login.
      if (handler.params.resource === "/user/changepassword") {
        return true;
      }

      // Vincular Telegram (`/user/linktelegram`): cualquier usuario con sesión
      // válida puede vincular su propio chat. El `admin` claim lo ata a su
      // cuenta; sin él (token de ApiKey) la operación de usuario no aplica.
      if (
        handler.params.resource === "/user/linktelegram" &&
        data_aut?.Bearer?.data?.admin
      ) {
        return true;
      }

      // Per-endpoint user allowlist (`endpoint.ctrl.users`). The canonical
      // value is an array of iduser (BIGINT, as number or string). Usernames
      // are also accepted for compatibility with older documentation/backups.
      // An empty array means "no per-user restriction"; the resource
      // permission below still applies.
      const endpointUsers = Array.isArray(handler.params.ctrl?.users)
        ? handler.params.ctrl.users
        : [];
      if (endpointUsers.length > 0) {
        const iduser = user?.iduser;
        const username = user?.username;
        const allowed = endpointUsers.some((entry) => {
          if (entry === null || entry === undefined) return false;
          if (iduser !== null && iduser !== undefined && String(entry) === String(iduser)) {
            return true;
          }
          return username !== null && username !== undefined && String(entry) === String(username);
        });
        if (!allowed) return false;
      }

      // Any authenticated user (no resource permission required). Used by
      // documentation/discovery/self-service endpoints that used to be public
      // and only need a valid session, never a granular permission.
      if (handler.params.ctrl?.authenticated === true) {
        return true;
      }

      // Granular ctrl.env evaluation
      if (handler.params.app === "system") {
        const endpointResource = handler.params.ctrl?.resource || null;
        const resolvedResource =
          endpointResource ||
          resolveResource(handler.params.ctrl, handler.params.resource);
        const environment = handler.params.environment;
        const action = actionFromMethod(handler.params.method);

        if (resolvedResource) {
          check = hasPermission(userCtrl, environment, resolvedResource, action);
        } else {
          // Unmapped resource → deny (system app requires explicit permission)
          check = false;
        }
      }
    }

    return check;
  }

  /**
   * Re-reads the user from the DB using the JWT admin claim.
   * Returns null if the user no longer exists or the lookup fails.
   */
  static async freshUser(tokenUser) {
    if (!tokenUser?.iduser) {
      // Token interno de sistema creado por CreateOpenFusionAPIToken
      // (index.js en el arranque): no corresponde a ninguna fila de usuario,
      // por lo que no hay nada que releer de la BD. Es el token con el que el
      // scheduler de interval tasks autentica los endpoints de la app system.
      if (
        tokenUser?.username === "openfusionapi" &&
        tokenUser?.ctrl?.as_admin === true
      ) {
        return tokenUser;
      }
      return null;
    }
    try {
      const fresh = await getUserById(tokenUser.iduser);
      return fresh ? (fresh.toJSON ? fresh.toJSON() : fresh) : null;
    } catch (error) {
      console.error("AuthService.freshUser:", error);
      return null;
    }
  }

  static async check_auth_Basic(handler, data_aut) {
    const user = await login(data_aut.Basic.username, data_aut.Basic.password);

    if (user.login) {
      data_aut.Bearer.data = user;
      return AuthService.check_auth_Bearer(handler, data_aut) ? user : null;
    } else {
      return false;
    }
  }

  /**
   * True when the request originates from the loopback interface.
   * Used by `access: 4` ("Local only"): the endpoint still requires a valid
   * token, but it is only reachable from the same host.
   */
  static isLocalRequest(request) {
    const candidates = [
      request?.ip,
      request?.socket?.remoteAddress,
      request?.raw?.socket?.remoteAddress,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());

    return candidates.some((address) => {
      // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) and plain loopback.
      const normalized = address.startsWith("::ffff:") ? address.slice(7) : address;
      return (
        normalized === "::1" ||
        normalized === "localhost" ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
      );
    });
  }

  static async check_auth(handler, request, reply) {
    // access: 4 = "Local only". Enforced before authentication so a remote
    // client cannot even probe credentials against local-only endpoints.
    if (handler.params.access === 4 && !AuthService.isLocalRequest(request)) {
      reply.code(403).send({
        error: "This endpoint is only available from localhost.",
        url: request.url,
      });
      return;
    }

    if (handler.params.access > 0) {
      const data_aut = getUserPasswordTokenFromRequest(request);

      if (handler.params.app === "system") {
        if (await AuthService.check_auth_Bearer(handler, data_aut)) {
          request.openfusionapi.user = data_aut.Bearer.data;
        } else {
          reply.code(401).send({
            error: "The System API requires a valid Token.",
            url: request.url,
          });
          return;
        }
      } else {
        switch (handler.params.access) {
          case 1: // Basic
            if (data_aut.Basic.username && data_aut.Basic.password) {
              const checkbasic = await AuthService.check_auth_Basic(
                handler,
                data_aut
              );
              if (checkbasic) {
                request.openfusionapi.user = checkbasic;
              } else {
                reply.code(401).send({
                  error: "Invalid Username or Password",
                  url: request.url,
                });
                return;
              }
            } else {
              reply.code(401).send({
                error: "The API requires a valid Username y Password",
                url: request.url,
              });
            }
            break;

          case 3:
            if (await AuthService.check_auth_Bearer(handler, data_aut)) {
              request.openfusionapi.user = data_aut.Bearer.data;
            } else if (data_aut.Basic.username && data_aut.Basic.password) {
              const checkbasic = await AuthService.check_auth_Basic(
                handler,
                data_aut
              );
              if (checkbasic) {
                request.openfusionapi.user = checkbasic;
              } else {
                reply.code(401).send({
                  error: "Invalid Username or Password",
                  url: request.url,
                });
                return;
              }
            } else {
              reply.code(401).send({
                error: "The API requires a Token or Username and Password",
                url: request.url,
              });
            }
            break;

          default:
            if (await AuthService.check_auth_Bearer(handler, data_aut)) {
              request.openfusionapi.user = data_aut.Bearer.data;
            } else {
              reply.code(401).send({
                error: "The API requires a valid Token.",
                url: request.url,
              });
              return;
            }
            break;
        }
      }
    }
  }
}
