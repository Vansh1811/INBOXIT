/**
 * Terminal Express error handler (O-M2).
 *
 * Guarantees every failure responds with the project-wide JSON contract:
 *   { message: string, requestId?: string }
 *
 * - 4xx-class errors pass their message through (they are intentional).
 * - 5xx details are logged server-side but NEVER leaked to clients.
 *
 * Must be registered AFTER all routes.
 */
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const isClientError = status >= 400 && status < 500;

  if (req.log) {
    req.log.error(
      { status, stack: err.stack },
      isClientError ? err.message : "Unhandled request error"
    );
  } else {
    console.error(`[error] ${status} ${err.message}`, err.stack);
  }

  res.status(status).json({
    message: isClientError
      ? err.message || "Request failed"
      : "Internal server error",
    ...(req.id ? { requestId: req.id } : {}),
  });
}

module.exports = { errorHandler };
