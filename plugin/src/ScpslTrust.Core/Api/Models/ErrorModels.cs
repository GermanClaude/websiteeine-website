using System.Text.Json;

namespace ScpslTrust.Core.Api.Models
{
    /// <summary><c>{ "error": { code, message, details?, request_id } }</c> (ARCHITECTURE §2.1).</summary>
    public sealed class ErrorResponse
    {
        public ErrorBody? Error { get; set; }
    }

    public sealed class ErrorBody
    {
        public string? Code { get; set; }

        public string? Message { get; set; }

        public JsonElement? Details { get; set; }

        public string? RequestId { get; set; }
    }

    /// <summary>Backend error codes the plugin reacts to (full list: shared/src/errors.ts).</summary>
    public static class ApiErrorCodes
    {
        public const string ValidationFailed = "VALIDATION_FAILED";
        public const string InvalidAuthHeaders = "INVALID_AUTH_HEADERS";
        public const string MissingAuthHeaders = "MISSING_AUTH_HEADERS";
        public const string InvalidSignature = "INVALID_SIGNATURE";
        public const string TimestampOutOfRange = "TIMESTAMP_OUT_OF_RANGE";
        public const string ReplayedNonce = "REPLAYED_NONCE";
        public const string DuplicateRequestId = "DUPLICATE_REQUEST_ID";
        public const string UnknownServer = "UNKNOWN_SERVER";
        public const string KeyRevoked = "KEY_REVOKED";
        public const string NoActiveKey = "NO_ACTIVE_KEY";
        public const string ServerSuspended = "SERVER_SUSPENDED";
        public const string ServerRevoked = "SERVER_REVOKED";
        public const string ServerIdMismatch = "SERVER_ID_MISMATCH";
        public const string RegistrationTokenInvalid = "REGISTRATION_TOKEN_INVALID";
        public const string ProofOfPossessionInvalid = "PROOF_OF_POSSESSION_INVALID";
        public const string InvalidTimestamp = "INVALID_TIMESTAMP";
        public const string PublicKeyInUse = "PUBLIC_KEY_IN_USE";
        public const string LinkCodeInvalid = "LINK_CODE_INVALID";
        public const string PlayerAlreadyLinked = "PLAYER_ALREADY_LINKED";
        public const string NotFound = "NOT_FOUND";
        public const string InvalidState = "INVALID_STATE";
        public const string Conflict = "CONFLICT";
        public const string RateLimited = "RATE_LIMITED";
        public const string OpenReportExists = "OPEN_REPORT_EXISTS";
        public const string InternalError = "INTERNAL_ERROR";
        public const string ServiceUnavailable = "SERVICE_UNAVAILABLE";

        // Client-side codes (never sent by the backend).
        public const string Timeout = "CLIENT_TIMEOUT";
        public const string NetworkError = "CLIENT_NETWORK_ERROR";
        public const string InvalidResponse = "CLIENT_INVALID_RESPONSE";
        public const string NotRegistered = "CLIENT_NOT_REGISTERED";
        public const string UnexpectedStatus = "CLIENT_UNEXPECTED_STATUS";
    }
}
