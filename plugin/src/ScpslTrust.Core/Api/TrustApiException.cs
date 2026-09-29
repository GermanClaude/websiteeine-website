using System;
using ScpslTrust.Core.Api.Models;

namespace ScpslTrust.Core.Api
{
    public enum TrustApiErrorKind
    {
        /// <summary>The backend answered with an error status (see <see cref="TrustApiException.Code"/>).</summary>
        Http,

        /// <summary>No response within the configured request timeout.</summary>
        Timeout,

        /// <summary>DNS, TCP or TLS failure.</summary>
        Network,

        /// <summary>A 2xx response that does not match the expected schema, or an oversized body.</summary>
        InvalidResponse,

        /// <summary>A signed call was attempted before the server was registered.</summary>
        NotRegistered,
    }

    /// <summary>
    /// Failure of a backend call. <see cref="Code"/> is the backend error code
    /// (<c>{ "error": { "code" } }</c>) or a <c>CLIENT_*</c> code for local failures.
    /// </summary>
    public sealed class TrustApiException : Exception
    {
        public TrustApiException(TrustApiErrorKind kind, string code, string message, int? statusCode = null, string? requestId = null, Exception? innerException = null)
            : base(message, innerException)
        {
            Kind = kind;
            Code = code ?? ApiErrorCodes.UnexpectedStatus;
            StatusCode = statusCode;
            RequestId = requestId;
        }

        public TrustApiErrorKind Kind { get; }

        public string Code { get; }

        public int? StatusCode { get; }

        /// <summary>Request id of the failed call (as sent by the plugin or reported by the backend).</summary>
        public string? RequestId { get; }

        /// <summary>Worth retrying later: timeouts, network errors, 5xx and rate limiting.</summary>
        public bool IsTransient =>
            Kind == TrustApiErrorKind.Timeout
            || Kind == TrustApiErrorKind.Network
            || (StatusCode.HasValue && (StatusCode.Value >= 500 || StatusCode.Value == 429));

        /// <summary>The backend rejected this server's credentials (signature, key, server status).</summary>
        public bool IsAuthenticationFailure =>
            Kind == TrustApiErrorKind.Http && (StatusCode == 401 || Code == ApiErrorCodes.ServerSuspended || Code == ApiErrorCodes.ServerRevoked);

        /// <summary>Short, log-safe description: <c>CODE (HTTP 401, request …)</c>.</summary>
        public string Describe()
        {
            var text = Code;
            if (StatusCode.HasValue)
            {
                text += " (HTTP " + StatusCode.Value;
                text += RequestId != null ? ", request " + RequestId + ")" : ")";
            }
            else if (RequestId != null)
            {
                text += " (request " + RequestId + ")";
            }

            return text;
        }
    }
}
