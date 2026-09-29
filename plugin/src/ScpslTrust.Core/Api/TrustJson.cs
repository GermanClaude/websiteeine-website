using System;
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace ScpslTrust.Core.Api
{
    /// <summary>
    /// JSON conventions of the wire format (ARCHITECTURE §2.1): snake_case keys, lowercase
    /// snake_case enum values, nulls omitted when writing, ISO-8601 UTC timestamps with milliseconds.
    /// </summary>
    public static class TrustJson
    {
        /// <summary>Shared, read-only serializer options.</summary>
        public static readonly JsonSerializerOptions Options = CreateOptions(writeIndented: false);

        /// <summary>Indented variant for human-readable local files and tool output (never sent on the wire).</summary>
        public static readonly JsonSerializerOptions IndentedOptions = CreateOptions(writeIndented: true);

        public static byte[] SerializeToUtf8Bytes<T>(T value) => JsonSerializer.SerializeToUtf8Bytes(value, Options);

        public static string Serialize<T>(T value, bool indented = false) => JsonSerializer.Serialize(value, indented ? IndentedOptions : Options);

        public static T? Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);

        public static T? Deserialize<T>(byte[] utf8Json) => JsonSerializer.Deserialize<T>(new ReadOnlySpan<byte>(utf8Json), Options);

        /// <summary>ISO-8601 UTC with milliseconds, e.g. <c>2026-09-29T15:42:20.000Z</c> (JavaScript toISOString form).</summary>
        public static string FormatTimestamp(DateTimeOffset value)
        {
            return value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        }

        private static JsonSerializerOptions CreateOptions(bool writeIndented)
        {
            var options = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                NumberHandling = JsonNumberHandling.Strict,
                ReadCommentHandling = JsonCommentHandling.Disallow,
                AllowTrailingCommas = false,
                MaxDepth = 32,
                WriteIndented = writeIndented,
                // Files and console output stay readable; wire JSON keeps the default (strict) escaping.
                Encoder = writeIndented ? JavaScriptEncoder.UnsafeRelaxedJsonEscaping : null,
                TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
            };
            options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower, allowIntegerValues: false));
            options.Converters.Add(new IsoDateTimeOffsetConverter());
            options.MakeReadOnly();
            return options;
        }
    }

    /// <summary>Reads any ISO-8601 timestamp; writes UTC with milliseconds and a <c>Z</c> suffix.</summary>
    public sealed class IsoDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.String)
            {
                throw new JsonException("Expected an ISO-8601 timestamp string.");
            }

            var text = reader.GetString();
            if (text == null
                || text.Length < 10
                || !DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value))
            {
                throw new JsonException("Invalid ISO-8601 timestamp.");
            }

            return value;
        }

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(TrustJson.FormatTimestamp(value));
        }
    }
}
