using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Api
{
    /// <summary>
    /// HTTP client of the plugin API. Every call except <c>GET /time</c> and <c>POST /servers/register</c>
    /// is signed (§5.3) over the exact bytes and path that are sent. Only idempotent calls are retried,
    /// each retry being a freshly signed request (new timestamp, nonce and request id).
    /// </summary>
    public sealed class TrustApiClient : ITrustApiClient, IDisposable
    {
        private readonly TrustApiClientOptions _options;
        private readonly IServerIdentityProvider _identities;
        private readonly IClock _clock;
        private readonly ITrustLogger _logger;
        private readonly RequestSigner _signer;
        private readonly HttpClient _http;

        /// <param name="handler">Transport; a redirect-free <see cref="HttpClientHandler"/> when null.</param>
        /// <param name="disposeHandler">Whether disposing this client disposes <paramref name="handler"/>.</param>
        public TrustApiClient(
            TrustApiClientOptions options,
            IServerIdentityProvider identities,
            IClock clock,
            ITrustLogger logger,
            HttpMessageHandler? handler = null,
            bool disposeHandler = true)
        {
            _options = options ?? throw new ArgumentNullException(nameof(options));
            _identities = identities ?? throw new ArgumentNullException(nameof(identities));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
            _signer = new RequestSigner(clock, options.PluginVersion);
            // Redirects would change the signed path and could forward signed headers to another host.
            _http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }, handler == null || disposeHandler)
            {
                Timeout = System.Threading.Timeout.InfiniteTimeSpan,
            };
        }

        public Task<TimeResponse> GetTimeAsync(CancellationToken cancellationToken = default)
        {
            return SendAsync<TimeResponse>(HttpMethod.Get, ApiPaths.Time, null, signed: false, idempotent: true, signWith: null, cancellationToken);
        }

        public async Task<ServerRegisterResponse> RegisterAsync(string registrationToken, Ed25519KeyPair keyPair, string? gameVersion, CancellationToken cancellationToken = default)
        {
            if (!RegistrationTokens.IsValid(registrationToken))
            {
                throw new ArgumentException("Registration token must look like sreg_ followed by 43 base64url characters.", nameof(registrationToken));
            }

            if (keyPair == null)
            {
                throw new ArgumentNullException(nameof(keyPair));
            }

            var timestamp = _clock.UtcNow.ToUnixTimeMilliseconds();
            var request = new ServerRegisterRequest
            {
                RegistrationToken = registrationToken,
                PublicKey = keyPair.PublicKeyBase64,
                PluginVersion = _options.PluginVersion,
                GameVersion = string.IsNullOrWhiteSpace(gameVersion) ? null : gameVersion,
                Timestamp = timestamp,
                PopSignature = PopMessages.SignRegistration(keyPair, registrationToken, timestamp),
            };
            var response = await SendAsync<ServerRegisterResponse>(HttpMethod.Post, ApiPaths.Register, request, signed: false, idempotent: false, signWith: null, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(response.KeyFingerprint, keyPair.Fingerprint, StringComparison.Ordinal))
            {
                throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend registered a different key fingerprint than the one sent.");
            }

            return response;
        }

        public Task<ServerHeartbeatResponse> HeartbeatAsync(ServerHeartbeatRequest request, ServerIdentity? signWith = null, CancellationToken cancellationToken = default)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            return SendAsync<ServerHeartbeatResponse>(HttpMethod.Post, ApiPaths.Heartbeat, request, signed: true, idempotent: true, signWith, cancellationToken);
        }

        public async Task<KeyRotateResponse> RotateKeyAsync(Ed25519KeyPair newKeyPair, CancellationToken cancellationToken = default)
        {
            if (newKeyPair == null)
            {
                throw new ArgumentNullException(nameof(newKeyPair));
            }

            var current = RequireIdentity(null);
            if (string.Equals(current.Fingerprint, newKeyPair.Fingerprint, StringComparison.Ordinal))
            {
                throw new ArgumentException("The new key must differ from the current key.", nameof(newKeyPair));
            }

            var timestamp = _clock.UtcNow.ToUnixTimeMilliseconds();
            var request = new KeyRotateRequest
            {
                NewPublicKey = newKeyPair.PublicKeyBase64,
                Timestamp = timestamp,
                PopSignature = PopMessages.SignRotation(newKeyPair, current.ServerId!, timestamp),
            };
            var response = await SendAsync<KeyRotateResponse>(HttpMethod.Post, ApiPaths.RotateKey, request, signed: true, idempotent: false, current, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(response.KeyFingerprint, newKeyPair.Fingerprint, StringComparison.Ordinal))
            {
                throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend activated a different key fingerprint than the one sent.");
            }

            return response;
        }

        public Task<ServerPolicy> GetPolicyAsync(CancellationToken cancellationToken = default)
        {
            return SendAsync<ServerPolicy>(HttpMethod.Get, ApiPaths.Policy, null, signed: true, idempotent: true, signWith: null, cancellationToken);
        }

        public Task<PlayerCheckResponse> CheckPlayerAsync(PlayerCheckRequest request, CancellationToken cancellationToken = default)
        {
            RequirePlayer(request?.Player, nameof(request));
            return SendAsync<PlayerCheckResponse>(HttpMethod.Post, ApiPaths.PlayerCheck, request, signed: true, idempotent: false, signWith: null, cancellationToken);
        }

        public Task<BypassCheckResponse> CheckBypassAsync(BypassCheckRequest request, CancellationToken cancellationToken = default)
        {
            RequirePlayer(request?.Player, nameof(request));
            return SendAsync<BypassCheckResponse>(HttpMethod.Post, ApiPaths.BypassCheck, request, signed: true, idempotent: false, signWith: null, cancellationToken);
        }

        public Task<PlayerLinkResponse> LinkPlayerAsync(PlayerLinkRequest request, CancellationToken cancellationToken = default)
        {
            RequirePlayer(request?.Player, nameof(request));
            return SendAsync<PlayerLinkResponse>(HttpMethod.Post, ApiPaths.PlayerLink, request, signed: true, idempotent: false, signWith: null, cancellationToken);
        }

        public Task<ServerReportResponse> SubmitReportAsync(ServerReportRequest request, CancellationToken cancellationToken = default)
        {
            RequirePlayer(request?.Player, nameof(request));
            return SendAsync<ServerReportResponse>(HttpMethod.Post, ApiPaths.ServerReports, request, signed: true, idempotent: false, signWith: null, cancellationToken);
        }

        public Task<OverwatchSessionStartResponse> StartOverwatchSessionAsync(OverwatchSessionStartRequest request, CancellationToken cancellationToken = default)
        {
            RequirePlayer(request?.TargetPlayer, nameof(request));
            RequirePlayer(request!.Spectator, nameof(request));
            return SendAsync<OverwatchSessionStartResponse>(HttpMethod.Post, ApiPaths.OverwatchSessions, request, signed: true, idempotent: false, signWith: null, cancellationToken);
        }

        public Task<OverwatchSessionHeartbeatResponse> OverwatchHeartbeatAsync(Guid sessionId, CancellationToken cancellationToken = default)
        {
            return SendAsync<OverwatchSessionHeartbeatResponse>(HttpMethod.Post, ApiPaths.OverwatchHeartbeat(sessionId), EmptyRequest.Instance, signed: true, idempotent: true, signWith: null, cancellationToken);
        }

        public Task<OverwatchSessionEndResponse> EndOverwatchSessionAsync(Guid sessionId, OverwatchEndReason reason, CancellationToken cancellationToken = default)
        {
            var request = new OverwatchSessionEndRequest { Reason = reason };
            return SendAsync<OverwatchSessionEndResponse>(HttpMethod.Post, ApiPaths.OverwatchEnd(sessionId), request, signed: true, idempotent: false, signWith: null, cancellationToken);
        }

        public void Dispose() => _http.Dispose();

        private static void RequirePlayer(Players.PlayerRef? player, string parameter)
        {
            if (player == null)
            {
                throw new ArgumentException("A player reference is required.", parameter);
            }
        }

        private ServerIdentity RequireIdentity(ServerIdentity? signWith)
        {
            var identity = signWith ?? _identities.Current;
            if (identity == null || !identity.IsRegistered)
            {
                throw new TrustApiException(TrustApiErrorKind.NotRegistered, ApiErrorCodes.NotRegistered, "This server is not registered with the trust network yet.");
            }

            return identity;
        }

        private async Task<T> SendAsync<T>(
            HttpMethod method,
            string path,
            object? body,
            bool signed,
            bool idempotent,
            ServerIdentity? signWith,
            CancellationToken cancellationToken)
            where T : class
        {
            var attempts = idempotent ? 1 + Math.Max(0, _options.IdempotentRetries) : 1;
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    return await SendOnceAsync<T>(method, path, body, signed, signWith, cancellationToken).ConfigureAwait(false);
                }
                catch (TrustApiException ex) when (ex.IsTransient && attempt < attempts && !cancellationToken.IsCancellationRequested)
                {
                    _logger.Debug(method.Method + " " + path + " failed with " + ex.Describe() + "; retrying.");
                    await Task.Delay(_options.RetryDelay, cancellationToken).ConfigureAwait(false);
                }
            }
        }

        private async Task<T> SendOnceAsync<T>(HttpMethod method, string path, object? body, bool signed, ServerIdentity? signWith, CancellationToken cancellationToken)
            where T : class
        {
            var identity = signed ? RequireIdentity(signWith) : null;
            var bodyBytes = body == null ? Array.Empty<byte>() : JsonSerializer.SerializeToUtf8Bytes(body, body.GetType(), TrustJson.Options);
            var uri = new Uri(_options.BaseUri.GetLeftPart(UriPartial.Authority) + _options.BaseUri.AbsolutePath.TrimEnd('/') + path, UriKind.Absolute);
            string? requestId = null;

            using (var request = new HttpRequestMessage(method, uri))
            {
                request.Headers.TryAddWithoutValidation("User-Agent", _options.UserAgent);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                if (body != null)
                {
                    request.Content = new ByteArrayContent(bodyBytes);
                    request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
                }

                if (identity != null)
                {
                    // Sign exactly what goes on the wire: the escaped path+query of the request URI and the body bytes.
                    var headers = _signer.Sign(identity, method.Method, uri.PathAndQuery, bodyBytes);
                    requestId = headers.RequestId;
                    foreach (var header in headers.ToHeaders())
                    {
                        request.Headers.TryAddWithoutValidation(header.Key, header.Value);
                    }
                }

                var stopwatch = Stopwatch.StartNew();
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    timeout.CancelAfter(_options.RequestTimeout);
                    HttpResponseMessage response;
                    try
                    {
                        response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                    {
                        throw new TrustApiException(TrustApiErrorKind.Timeout, ApiErrorCodes.Timeout, "The trust backend did not respond within " + _options.RequestTimeout.TotalSeconds.ToString("0.#", CultureInfo.InvariantCulture) + " s.", requestId: requestId);
                    }
                    catch (HttpRequestException ex)
                    {
                        throw new TrustApiException(TrustApiErrorKind.Network, ApiErrorCodes.NetworkError, "Cannot reach the trust backend: " + ex.Message + NetworkErrorHint(ex), requestId: requestId, innerException: ex);
                    }

                    using (response)
                    {
                        byte[] responseBytes;
                        try
                        {
                            responseBytes = await ReadBodyAsync(response.Content, _options.MaxResponseBytes, timeout.Token).ConfigureAwait(false);
                        }
                        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                        {
                            throw new TrustApiException(TrustApiErrorKind.Timeout, ApiErrorCodes.Timeout, "Timed out while reading the backend response.", (int)response.StatusCode, requestId);
                        }
                        catch (IOException ex)
                        {
                            throw new TrustApiException(TrustApiErrorKind.Network, ApiErrorCodes.NetworkError, "The backend response was interrupted.", (int)response.StatusCode, requestId, ex);
                        }

                        var status = (int)response.StatusCode;
                        requestId = HeaderValue(response, SigningHeaderNames.RequestId) ?? requestId;
                        _logger.Debug(method.Method + " " + path + " -> " + status.ToString(CultureInfo.InvariantCulture) + " in " + stopwatch.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture) + " ms" + (requestId != null ? " (request " + requestId + ")" : string.Empty));

                        if (status < 200 || status > 299)
                        {
                            throw ToHttpError(status, responseBytes, requestId);
                        }

                        var result = Parse<T>(responseBytes, requestId, status);
                        if (identity != null)
                        {
                            _identities.OnSignedRequestSucceeded(identity);
                        }

                        return result;
                    }
                }
            }
        }

        private static T Parse<T>(byte[] bytes, string? requestId, int status)
            where T : class
        {
            T? value;
            try
            {
                value = JsonSerializer.Deserialize<T>(new ReadOnlySpan<byte>(bytes), TrustJson.Options);
            }
            catch (JsonException)
            {
                throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend returned malformed JSON for " + typeof(T).Name + ".", status, requestId);
            }
            catch (NotSupportedException)
            {
                throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend returned an unsupported JSON shape for " + typeof(T).Name + ".", status, requestId);
            }

            if (value == null)
            {
                throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend returned an empty " + typeof(T).Name + ".", status, requestId);
            }

            if (value is IApiResponse validatable)
            {
                try
                {
                    validatable.Validate();
                }
                catch (ApiResponseValidationException ex)
                {
                    throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, ex.Message, status, requestId);
                }
            }

            return value;
        }

        private static TrustApiException ToHttpError(int status, byte[] bytes, string? requestId)
        {
            ErrorBody? error = null;
            if (bytes.Length > 0)
            {
                try
                {
                    error = JsonSerializer.Deserialize<ErrorResponse>(new ReadOnlySpan<byte>(bytes), TrustJson.Options)?.Error;
                }
                catch (JsonException)
                {
                    error = null;
                }
            }

            if (error?.Code == null)
            {
                return new TrustApiException(TrustApiErrorKind.Http, ApiErrorCodes.UnexpectedStatus, "The trust backend answered HTTP " + status.ToString(CultureInfo.InvariantCulture) + ".", status, requestId);
            }

            return new TrustApiException(TrustApiErrorKind.Http, Truncate(error.Code, 64), Truncate(error.Message ?? error.Code, 300), status, error.RequestId ?? requestId);
        }

        /// <summary>
        /// Mono's HttpClient (the game runtime) always opens an IPv6 dual-mode socket; on hosts whose kernel has
        /// no IPv6 support at all this fails with EAFNOSUPPORT even for IPv4 backends (seen on a real server).
        /// </summary>
        internal static string NetworkErrorHint(Exception ex)
        {
            for (var e = ex.InnerException; e != null; e = e.InnerException)
            {
                if (e is System.Net.Sockets.SocketException se && se.SocketErrorCode == System.Net.Sockets.SocketError.AddressFamilyNotSupported)
                {
                    return " (this host has no IPv6 support, which the game's HTTP stack requires even for IPv4 backends; enable IPv6 in the kernel/container, see docs/PLUGIN.md troubleshooting)";
                }
            }

            return string.Empty;
        }

        private static async Task<byte[]> ReadBodyAsync(HttpContent? content, int maxBytes, CancellationToken cancellationToken)
        {
            if (content == null)
            {
                return Array.Empty<byte>();
            }

            if (content.Headers.ContentLength > maxBytes)
            {
                throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend response exceeds " + maxBytes.ToString(CultureInfo.InvariantCulture) + " bytes.");
            }

            using (var stream = await content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var buffer = new MemoryStream())
            {
                var chunk = new byte[8192];
                while (true)
                {
                    var read = await stream.ReadAsync(chunk, 0, chunk.Length, cancellationToken).ConfigureAwait(false);
                    if (read == 0)
                    {
                        return buffer.ToArray();
                    }

                    if (buffer.Length + read > maxBytes)
                    {
                        throw new TrustApiException(TrustApiErrorKind.InvalidResponse, ApiErrorCodes.InvalidResponse, "The backend response exceeds " + maxBytes.ToString(CultureInfo.InvariantCulture) + " bytes.");
                    }

                    buffer.Write(chunk, 0, read);
                }
            }
        }

        private static string? HeaderValue(HttpResponseMessage response, string name)
        {
            return response.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;
        }

        private static string Truncate(string value, int max)
        {
            var sanitized = new StringBuilder(Math.Min(value.Length, max));
            foreach (var c in value)
            {
                if (sanitized.Length >= max)
                {
                    break;
                }

                sanitized.Append(char.IsControl(c) ? ' ' : c);
            }

            return sanitized.ToString();
        }
    }

    /// <summary>Plugin API paths (all under <c>/api/v1</c>).</summary>
    public static class ApiPaths
    {
        public const string Time = TrustApiClientOptions.ApiPrefix + "/time";
        public const string Register = TrustApiClientOptions.ApiPrefix + "/servers/register";
        public const string Heartbeat = TrustApiClientOptions.ApiPrefix + "/servers/heartbeat";
        public const string RotateKey = TrustApiClientOptions.ApiPrefix + "/servers/keys/rotate";
        public const string Policy = TrustApiClientOptions.ApiPrefix + "/servers/policy";
        public const string PlayerCheck = TrustApiClientOptions.ApiPrefix + "/player/check";
        public const string BypassCheck = TrustApiClientOptions.ApiPrefix + "/player/bypass/check";
        public const string PlayerLink = TrustApiClientOptions.ApiPrefix + "/player/link";
        public const string ServerReports = TrustApiClientOptions.ApiPrefix + "/server/reports";
        public const string OverwatchSessions = TrustApiClientOptions.ApiPrefix + "/overwatch/sessions";

        public static string OverwatchHeartbeat(Guid sessionId) => OverwatchSessions + "/" + sessionId.ToString("D") + "/heartbeat";

        public static string OverwatchEnd(Guid sessionId) => OverwatchSessions + "/" + sessionId.ToString("D") + "/end";
    }
}
