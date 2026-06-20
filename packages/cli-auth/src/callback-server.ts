import { createServer, type Server, type ServerResponse } from "node:http";
import { config, loginCompleteErrorUrl } from "./config";
import type { AuthContext } from "./types";

type CallbackResult =
  | {
      code: string;
      ok: true;
    }
  | {
      errorMessage: string;
      message: string;
      ok: false;
    };

export async function startCallbackServer(
  ctx: AuthContext,
  expectedState: string,
) {
  const callbackUrl = new URL(config.redirectUri);
  let complete = false;
  let failCallback: (error: Error) => void = () => undefined;
  let finishCallback: (code: string) => void = () => undefined;

  const callback = new Promise<string>((resolve, reject) => {
    failCallback = reject;
    finishCallback = resolve;
  });

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", config.redirectUri);

    if (requestUrl.pathname !== callbackUrl.pathname) {
      endResponse(response, 404, "Not found.", "text/plain; charset=utf-8");
      return;
    }

    if (complete) {
      endResponse(
        response,
        409,
        "Login callback was already handled.",
        "text/plain; charset=utf-8",
      );
      return;
    }

    complete = true;
    ctx.log.debug("Received login callback.");

    const callbackResult = readCallbackResult(requestUrl, expectedState);
    if (!callbackResult.ok) {
      redirectResponse(
        response,
        loginCompleteErrorUrl(callbackResult.message),
      );
      failCallback(new Error(callbackResult.errorMessage));

      return;
    }

    redirectResponse(response, config.loginCompleteUrl);
    finishCallback(callbackResult.code);
  });

  ctx.log.debug(
    `Starting login callback server on ${callbackUrl.hostname}:${callbackUrl.port}.`,
  );
  await listen(server, Number(callbackUrl.port), callbackUrl.hostname);
  ctx.log.debug("Login callback server started.");

  server.on("error", (error) => {
    ctx.log.debug(error);
    failCallback(error);
  });

  const timeout = setTimeout(() => {
    ctx.log.debug("Login callback timed out.");
    failCallback(new Error("Timed out waiting for the browser callback."));
  }, config.loginTimeoutMs);

  return {
    waitForCode: async () => {
      try {
        return await callback;
      } finally {
        clearTimeout(timeout);
        ctx.log.debug("Closing login callback server.");
        await close(server);
      }
    },
  };
}

function readCallbackResult(
  requestUrl: URL,
  expectedState: string,
): CallbackResult {
  if (requestUrl.searchParams.get("state") !== expectedState) {
    return {
      errorMessage: "Login callback state did not match.",
      message: "State did not match. You can close this tab.",
      ok: false,
    };
  }

  if (requestUrl.searchParams.has("error")) {
    const errorMessage =
      requestUrl.searchParams.get("error_description") ??
      "Authorization was denied.";

    return {
      errorMessage,
      message: errorMessage,
      ok: false,
    };
  }

  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return {
      errorMessage: "Login callback did not include an authorization code.",
      message: "Missing authorization code. You can close this tab.",
      ok: false,
    };
  }

  return {
    code,
    ok: true,
  };
}

function listen(server: Server, port: number, hostname: string) {
  return new Promise<void>((resolve, reject) => {
    function fail(error: Error) {
      reject(error);
    }

    server.once("error", fail);
    server.listen(port, hostname, () => {
      server.off("error", fail);
      resolve();
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function endResponse(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
) {
  response.writeHead(status, {
    Connection: "close",
    "Content-Type": contentType,
  });
  response.end(body);
  response.socket?.destroy();
}

function redirectResponse(response: ServerResponse, location: string) {
  response.writeHead(302, {
    Connection: "close",
    Location: location,
  });
  response.end();
  response.socket?.destroy();
}
