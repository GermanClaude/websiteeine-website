using System;
using System.Collections.Generic;

namespace ScpslTrust.Core.Api.Models
{
    /// <summary>A response DTO that can check its required fields after deserialization.</summary>
    public interface IApiResponse
    {
        /// <summary>Throws <see cref="ApiResponseValidationException"/> when required data is missing or malformed.</summary>
        void Validate();
    }

    /// <summary>The backend returned a 2xx response that does not match the expected schema.</summary>
    public sealed class ApiResponseValidationException : Exception
    {
        public ApiResponseValidationException(string message)
            : base(message)
        {
        }
    }

    /// <summary>Bypass types (§3 BypassType); serialized lowercase snake_case.</summary>
    public enum BypassType
    {
        VpnWhitelist,
        AccountAgeWhitelist,
        AltAccountWhitelist,
        VerdictOverride,
    }

    /// <summary>End reasons a plugin may submit (§10.1); serialized lowercase snake_case.</summary>
    public enum OverwatchEndReason
    {
        TargetChanged,
        OverwatchDisabled,
        SpectatorLeft,
        TargetLeft,
        RoundEnded,
        Manual,
    }

    internal static class Require
    {
        public static void NotNull(object? value, string field)
        {
            if (value == null)
            {
                throw new ApiResponseValidationException("Response field '" + field + "' is missing.");
            }
        }

        public static void NotEmpty(string? value, string field)
        {
            if (string.IsNullOrEmpty(value))
            {
                throw new ApiResponseValidationException("Response field '" + field + "' is missing.");
            }
        }

        public static void NonNegative(int value, string field)
        {
            if (value < 0)
            {
                throw new ApiResponseValidationException("Response field '" + field + "' must not be negative.");
            }
        }

        public static void That(bool condition, string message)
        {
            if (!condition)
            {
                throw new ApiResponseValidationException(message);
            }
        }

        public static List<T> List<T>(List<T>? list) => list ?? new List<T>();
    }
}
