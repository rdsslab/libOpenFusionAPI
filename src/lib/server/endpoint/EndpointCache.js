import hash from "object-hash";
import { Buffer } from "node:buffer";
import { get_url_params } from "../utils_path.js";

/**
 * Manages all cache-related operations for the endpoint registry.
 * Responsible for: response caching, cache sizing, and request hashing.
 */
export class EndpointCache {
  /**
   * @param {object} internalEndpoint - Shared reference to the endpoint registry object.
   * @param {import("./TimedCache.js").TimedCache} cache - Shared TimedCache instance.
   */
  constructor(internalEndpoint, cache) {
    this._ep = internalEndpoint;
    this._cache = cache;
  }

  getCache(endpoint_key, hash_request) {
    if (
      this._ep &&
      this._ep[endpoint_key] &&
      this._ep[endpoint_key].responses &&
      this._ep[endpoint_key].responses[hash_request]?.data
    ) {
      return this._ep[endpoint_key].responses[hash_request].data;
    }
    return null;
  }

  clearCache(endpoint_key) {
    if (
      this._ep &&
      this._ep[endpoint_key] &&
      this._ep[endpoint_key].responses
    ) {
      this._ep[endpoint_key].responses = {};
      return true;
    }
    return false;
  }

  hash_request(request, endpoint_key) {
    return hash(
      {
        body: request.body,
        query: request.query,
        url_key: endpoint_key,
      },
      {
        algorithm: "sha256",
        respectType: true,
        unorderedObjects: false,
      }
    );
  }

  setCache(url_key, request, reply) {
    let ep = this._ep[url_key];

    if (ep) {
      const hash_request = request.openfusionapi.hash_request;
      const reply_lastResponse = reply?.openfusionapi?.lastResponse;

      if (
        reply.statusCode != 500 &&
        reply_lastResponse &&
        ep?.handler?.params?.cache_time > 0
      ) {
        let cache_stored = this._cache.get({
          app: ep?.handler?.params?.app,
          resource: ep?.handler?.params?.resource,
          env: ep?.handler?.params?.environment,
          method: request.method,
          hash: hash_request,
        });

        if (!cache_stored) {
          const contentLength = reply.getHeader("content-length");
          let sizeKB = 0;
          if (contentLength) {
            sizeKB = Number(contentLength) / 1024;
          } else {
            const lastRespData = reply_lastResponse?.data;
            if (Buffer.isBuffer(lastRespData)) {
              sizeKB = lastRespData.length / 1024;
            } else if (typeof lastRespData === "string") {
              sizeKB = Buffer.byteLength(lastRespData) / 1024;
            } else {
              try {
                sizeKB =
                  Buffer.byteLength(
                    JSON.stringify(reply_lastResponse),
                    "utf8"
                  ) / 1024;
              } catch (e) {
                sizeKB = 0;
              }
            }
          }

          let payload_cache = {
            data: reply?.openfusionapi?.lastResponse?.data ?? undefined,
            responseTime: reply?.openfusionapi?.lastResponse?.responseTime,
            size: sizeKB > 0 ? Math.round(sizeKB * 10000) / 10000 : 0,
            idendpoint: ep?.handler?.params?.idendpoint,
            idapp: ep?.handler?.params?.idapp,
            headers: reply?.openfusionapi?.lastResponse?.headers,
          };

          this._cache.add({
            app: ep?.handler?.params?.app,
            resource: ep?.handler?.params?.resource,
            env: ep?.handler?.params?.environment,
            method: request.method,
            hash: hash_request,
            timeout: ep?.handler?.params?.cache_time ?? 1,
            payload: payload_cache,
          });
        }
      }
    } else {
      console.log(`${url_key} not exists on cache (internal_endpoint)`);
    }
  }

  getCacheSize(app_name) {
    let r = { data: undefined, code: 204 };
    try {
      r.data = [];
      r.code = 200;
      const filteredKeys = Object.keys(this._ep).filter((key) => {
        let u = get_url_params(key);
        return u.app == app_name && this._ep[key].responses;
      });

      let sizeList = filteredKeys.map((key) => {
        return {
          idendpoint: this._ep[key]?.handler?.params?.idendpoint,
          size: this._cache.getCacheSizeEndpoint({
            app: app_name,
            resource: this._ep[key]?.handler?.params?.resource,
            env: this._ep[key]?.handler?.params?.environment,
            method: this._ep[key]?.handler?.params?.method,
          }),
        };
      });

      r.data = sizeList;
    } catch (error) {
      r.data = error;
      r.code = 500;
    }
    return r;
  }
}
