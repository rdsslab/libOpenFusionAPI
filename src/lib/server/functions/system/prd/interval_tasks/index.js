import {
  getIntervalTask,
  upsertIntervalTask,
  deleteIntervalTask,
} from "../../../../../db/interval_task.js";

export async function fnGetIntervalTasksByIdApp(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getIntervalTask({
      app: { idapp: params.request.query.idapp },
    });
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnUpsertIntervalTask(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = await upsertIntervalTask(params.request.body);
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fndeleteIntervalTask(params) {
  let r = { code: 204, data: undefined };
  try {
    // El body es `{ idtask }` con un id o un array de ids. Antes se pasaba el
    // body entero como valor del `where`, lo que obligaba a enviar el id pelado
    // y hacía imposible declarar un json_schema de objeto para la tool MCP.
    // Se acepta el body crudo como respaldo para los clientes HTTP antiguos.
    const body = params.request.body;
    const idtask =
      body && typeof body === "object" && !Array.isArray(body) ? body.idtask : body;

    r.data = await deleteIntervalTask(idtask);
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}
