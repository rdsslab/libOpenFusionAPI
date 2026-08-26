import { login } from "../db/user.js";
import { getUserPasswordTokenFromRequest } from "./auth.js";
import { hasPermission, actionFromMethod } from "./permissions.js";
import { resolveResource } from "./resourceMapper.js";

export class AuthService {
  /**
   * Evaluates Bearer-based authorization.
   *
   * Priority:
   *   1. ApiKey token → access granted if token's idapp matches the endpoint's idapp
   *   2. Internal user → superuser bypass, then as_admin bypass, then ctrl.env evaluation
   */
  static check_auth_Bearer(handler, data_aut) {
    let check = false;

    // ── ApiKey path ──
    if (data_aut?.Bearer?.data?.apikey?.idapp == handler.params.idapp) {
      check = true;
    } else if (data_aut?.Bearer?.data?.admin && handler.params) {
      const user = data_aut.Bearer.data.admin;
      const userCtrl = user.ctrl || {};

      // Super users — hardcoded bypass
      if (
        (user.username === "superopenfusionapi" ||
          user.username === "superuser") &&
        user.enabled
      ) {
        check = true;
      }
      // as_admin — global bypass (backward-compatible)
      else if (userCtrl.as_admin === true) {
        check = true;
      }
      // Granular ctrl.env evaluation
      else if (handler.params.app === "system") {
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

  static async check_auth_Basic(handler, data_aut) {
    const user = await login(data_aut.Basic.username, data_aut.Basic.password);

    if (user.login) {
      data_aut.Bearer.data = user;
      return AuthService.check_auth_Bearer(handler, data_aut) ? user : null;
    } else {
      return false;
    }
  }

  static async check_auth(handler, request, reply) {
    if (handler.params.access > 0) {
      const data_aut = getUserPasswordTokenFromRequest(request);

      if (handler.params.app === "system") {
        if (AuthService.check_auth_Bearer(handler, data_aut)) {
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
            if (AuthService.check_auth_Bearer(handler, data_aut)) {
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
            if (AuthService.check_auth_Bearer(handler, data_aut)) {
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
