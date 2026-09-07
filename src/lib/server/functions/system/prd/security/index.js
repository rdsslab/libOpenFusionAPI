import { User, ApiClient } from "../../../../../db/models.js";
import { EncryptPwd, getLegacyPasswordKeys, passwordMatches } from "../../../../../server/auth.js";

// @ts-ignore
import dbsequelize from "../../../../../db/sequelize.js";
import { Op } from "sequelize";

const HEX64 = /^[a-f0-9]{64}$/i;

const classifyValue = (value) => {
  const v = typeof value === "string" ? value.trim() : "";
  if (v === "") return "empty";
  if (HEX64.test(v)) return "hashed";
  return "clear";
};

async function collectStatus() {
  const users = await User.findAll({
    attributes: ["iduser", "username", "password"],
    raw: true,
  });
  const clients = await ApiClient.findAll({
    attributes: ["idclient", "username", "password"],
    raw: true,
  });

  const aggregate = (rows) => {
    const counted = { total: rows.length, hashed: 0, clear: 0, empty: 0 };
    const clearUsernames = [];
    for (const row of rows) {
      const kind = classifyValue(row.password);
      counted[kind] += 1;
      if (kind === "clear") clearUsernames.push(row.username);
    }
    return { ...counted, clear_usernames: clearUsernames };
  };

  return {
    users: aggregate(users),
    api_clients: aggregate(clients),
    legacy_keys: {
      configured: getLegacyPasswordKeys().length > 0,
      count: getLegacyPasswordKeys().length,
    },
    note: {
      clear: "Fila almacenada en claro (alta/reset previo al fix de hashing). Se puede re-hashear offline a la JWT_KEY actual.",
      hashed: "Hash HMAC-SHA256 (64 hex). Se migra a la JWT_KEY actual de forma automatica en el primer login valido (AUTH_LEGACY_KEYS).",
      empty: "Sin password almacenado: el login queda bloqueado para esa cuenta.",
    },
  };
}

const runMigration = async (dry_run, scope = "all") => {
  const status = await collectStatus();
  const migratedUsers = [];
  const migratedClients = [];
  const includeUsers = scope === "all" || scope === "users";
  const includeClients = scope === "all" || scope === "clients";

  if (!dry_run) {
    // @ts-ignore
    const tx = await dbsequelize.transaction();

    try {
      if (includeUsers) {
        const users = await User.findAll({
          attributes: ["iduser", "username", "password"],
          raw: true,
          transaction: tx,
        });
        for (const row of users) {
          if (classifyValue(row.password) === "clear") {
            await User.update(
              { password: EncryptPwd(row.password.trim()) },
              { where: { iduser: row.iduser }, transaction: tx },
            );
            migratedUsers.push(row.username);
          }
        }
      }

      if (includeClients) {
        const clients = await ApiClient.findAll({
          attributes: ["idclient", "username", "password"],
          raw: true,
          transaction: tx,
        });
        for (const row of clients) {
          if (classifyValue(row.password) === "clear") {
            await ApiClient.update(
              { password: EncryptPwd(row.password.trim()) },
              { where: { idclient: row.idclient }, transaction: tx },
            );
            migratedClients.push(row.username);
          }
        }
      }

      await tx.commit();
    } catch (error) {
      // @ts-ignore
      await tx.rollback();
      throw error;
    }
  }

  return {
    dry_run,
    scope,
    migrated_users: migratedUsers,
    migrated_clients: migratedClients,
    migrated_users_count: migratedUsers.length,
    migrated_clients_count: migratedClients.length,
    legacy_keys_configured: status.legacy_keys.configured,
    legacy_keys_count: status.legacy_keys.count,
  };
};

export async function fnPasswordMigrationStatus(params) {
  let r = { code: 204, data: undefined };
  try {
    r.data = await collectStatus();
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnPasswordMigrationRun(params) {
  let r = { code: 204, data: undefined };
  try {
    const body = params?.request?.body || {};
    const dry_run = body.dry_run === true;
    const scope = ["all", "users", "clients"].includes(body.scope) ? body.scope : "all";
    r.data = await runMigration(dry_run, scope);
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnPasswordMigrationValidate(params) {
  let r = { code: 204, data: undefined };
  try {
    const body = params?.request?.body || {};
    const type = body.type === "client" ? "client" : "user";
    const username = String(body.username || "");
    const password = String(body.password || "");

    if (!username || !password) {
      const schema = params?.handler?.params?.json_schema?.in?.schema;
      const required = schema?.required || ["type", "username", "password"];
      r.data = {
        error: `Credenciales de prueba incompletas. Campos requeridos: ${required.join(", ")}.`,
      };
      r.code = 400;
      return r;
    }

    const now = new Date();

    if (type === "client") {
      const client = await ApiClient.findOne({
        where: {
          username,
          status: ["active", "initial"],
          startAt: { [Op.lte]: now },
          [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }],
        },
        attributes: ["idclient", "username", "status", "password"],
        raw: true,
      });

      if (!client) {
        r.data = { type, username, found: false, valid: false };
        r.code = 200;
        return r;
      }

      const { valid, needsRehash } = passwordMatches(password, client.password);
      r.data = {
        type,
        username,
        found: true,
        valid,
        format: classifyValue(client.password),
        verifies_with: valid ? (needsRehash ? "legacy_or_clear" : "current_key") : null,
        would_rehash_on_login: !!(valid && needsRehash),
        note: valid
          ? needsRehash
            ? "El login comprobara esta credencial contra el fallback (claro/legacy) y re-hasheara en el mismo login."
            : "El login comprobara esta credencial con la JWT_KEY actual. Sin re-hash."
          : "Credencial no valida tras la rotacion (verifica con la clave nueva Y las legacy).",
      };
      r.code = 200;
      return r;
    }

    const user = await User.findOne({
      where: {
        username,
        enabled: true,
        start_date: { [Op.lte]: now },
        end_date: { [Op.gte]: now },
      },
      attributes: ["iduser", "username", "enabled", "password"],
      raw: true,
    });

    if (!user) {
      r.data = { type, username, found: false, valid: false };
      r.code = 200;
      return r;
    }

    const { valid, needsRehash } = passwordMatches(password, user.password);
    r.data = {
      type,
      username,
      found: true,
      valid,
      format: classifyValue(user.password),
      verifies_with: valid ? (needsRehash ? "legacy_or_clear" : "current_key") : null,
      would_rehash_on_login: !!(valid && needsRehash),
      note: valid
        ? needsRehash
          ? "El login comprobara esta credencial contra el fallback (claro/legacy) y re-hasheara en el mismo login."
          : "El login comprobara esta credencial con la JWT_KEY actual. Sin re-hash."
        : "Credencial no valida tras la rotacion (verifica con la clave nueva Y las legacy).",
    };
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}