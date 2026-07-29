import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_RESPONSE_BYTES = 1024 * 1024;
export const SAFE_INVOCATION_HEADERS = Object.freeze({
  "content-type": "application/json",
});

function invocationError(status, message) {
  return Object.assign(new Error(message), { status });
}

function ipv4Bytes(address) {
  const parts = address.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  ) {
    return null;
  }
  return parts.map(Number);
}

function ipv6Bytes(address) {
  let value = address.toLowerCase();
  if (value.includes("%")) return null;

  const dotted = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const bytes = ipv4Bytes(dotted[1]);
    if (!bytes) return null;
    value =
      value.slice(0, -dotted[1].length) +
      `${((bytes[0] << 8) | bytes[1]).toString(16)}:${(
        (bytes[2] << 8) |
        bytes[3]
      ).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.flatMap((group) => {
    const number = Number.parseInt(group, 16);
    return [number >> 8, number & 0xff];
  });
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const bytes = ipv4Bytes(address);
    if (!bytes) return false;
    const [a, b, c] = bytes;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family !== 6) return false;

  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (mapped || ipv4Compatible) {
    return isPublicAddress(bytes.slice(12).join("."));
  }

  return !(
    allZero ||
    loopback ||
    (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x0d &&
      bytes[3] === 0xb8) ||
    (bytes[0] === 0x01 && bytes.slice(1, 8).every((byte) => byte === 0)) ||
    (bytes[0] === 0x20 && bytes[1] === 0x02) ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x00)
  );
}

async function defaultResolveHostname(hostname) {
  return await lookup(hostname, { all: true, verbatim: true });
}

export async function validateInvocationUrl(
  rawUrl,
  { resolveHostname = defaultResolveHostname } = {},
) {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) {
    throw invocationError(400, "Invalid invocation URL");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invocationError(400, "Invalid invocation URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invocationError(400, "Invocation URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw invocationError(400, "Invocation URL credentials are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw invocationError(400, "Invocation URL targets a local address");
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveHostname(hostname);
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw invocationError(502, "Invocation hostname did not resolve");
  }
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw invocationError(400, "Invocation URL resolves to a non-public address");
  }

  return {
    url,
    address: addresses[0].address,
    family: Number(addresses[0].family),
  };
}

export function sendPinnedRequest(target, body, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = target.url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      target.url,
      {
        method: "POST",
        signal,
        family: target.family,
        autoSelectFamily: false,
        headers: SAFE_INVOCATION_HEADERS,
        lookup: (_hostname, _options, callback) =>
          callback(null, target.address, target.family),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(invocationError(502, "Agent endpoint response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

export async function requestJsonEndpoint(
  rawUrl,
  payload,
  {
    timeoutMs = 10_000,
    maxRedirects = 3,
    resolveHostname = defaultResolveHostname,
    transport = sendPinnedRequest,
  } = {},
) {
  const controller = new AbortController();
  let rejectTimeout;
  const timeoutPromise = new Promise((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(() => {
    const error = invocationError(504, "Agent endpoint timed out");
    controller.abort(error);
    rejectTimeout(error);
  }, timeoutMs);
  timeout.unref?.();

  try {
    const execute = async () => {
      let current = rawUrl;
      for (let redirects = 0; ; redirects += 1) {
        // Persisted URLs are untrusted. Validate and pin immediately before I/O.
        const target = await validateInvocationUrl(current, { resolveHostname });
        if (controller.signal.aborted) {
          throw invocationError(504, "Agent endpoint timed out");
        }
        let response;
        try {
          response = await transport(target, JSON.stringify(payload), {
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw invocationError(504, "Agent endpoint timed out");
          }
          throw error;
        }

        if (REDIRECT_STATUSES.has(response.statusCode)) {
          if (redirects >= maxRedirects) {
            throw invocationError(502, "Agent endpoint redirected too many times");
          }
          const location = response.headers.location;
          if (!location) {
            throw invocationError(502, "Agent endpoint redirect has no location");
          }
          current = new URL(location, target.url).toString();
          continue;
        }
        return response;
      }
    };
    return await Promise.race([execute(), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}
