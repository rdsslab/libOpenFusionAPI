export class DbHookCacheInvalidationService {
  constructor({
    endpoints,
    deleteEndpointsByAppName,
    applicationModel,
    appvarsModel,
    endpointModel,
    botModel,             // ← NUEVO: nombre de la tabla ofapi_bot
    onBotChanged,         // ← NUEVO: callback cuando cambia un bot
    appInvalidateDelayMs = 5000,
  }) {
    this.endpoints = endpoints;
    this.deleteEndpointsByAppName = deleteEndpointsByAppName;
    this.applicationModel = applicationModel;
    this.appvarsModel = appvarsModel;
    this.endpointModel = endpointModel;
    this.botModel = botModel;
    this.onBotChanged = onBotChanged;
    this.appInvalidateDelayMs = appInvalidateDelayMs;
  }

  handleHookData(data) {
    if (!data) return;

    if (data.model == this.applicationModel && data.action === "afterUpsert") {
      if (data.data?.app) {
        setTimeout(() => {
          this.deleteEndpointsByAppName(data.data?.app);
        }, this.appInvalidateDelayMs);
      }
      return;
    }

    if (
      data.model == this.appvarsModel &&
      (data.action === "afterUpsert" || data.action === "afterDestroy")
    ) {
      this.endpoints.deleteEndpointsByIdApp(data.data?.idapp, data.data?.environment);
      return;
    }

    if (
      data.model == this.endpointModel &&
      (data.action === "afterUpsert" || data.action === "afterDestroy")
    ) {
      this.endpoints.deleteEndpointByidEndpoint(
        data?.data?.idendpoint,
        data?.data?.environment,
      );
    }

    if (
      this.botModel &&
      data.model === this.botModel &&
      (data.action === "afterUpsert" ||
        data.action === "afterCreate" ||
        data.action === "afterUpdate" ||
        data.action === "afterDestroy")
    ) {
      // Notificar al lifecycle para que sincronice de inmediato
      if (typeof this.onBotChanged === "function") {
        this.onBotChanged(data);
      }
      return;
    }
  }
}
