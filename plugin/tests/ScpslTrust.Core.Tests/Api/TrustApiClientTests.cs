using System.Net;
using System.Text.Json;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Api;

public sealed class TrustApiClientTests : IDisposable
{
    private const string ServerId = "srv_7k4x92m8pq174kf9";
    private static readonly PlayerRef Player = new(PlayerIdType.Steam, "76561198000000001");

    private readonly Ed25519KeyPair _key = Ed25519KeyPair.Generate();
    private readonly FakeClock _clock = new(DateTimeOffset.FromUnixTimeMilliseconds(1_790_000_000_000));
    private readonly TestIdentityProvider _identities;

    public TrustApiClientTests()
    {
        _identities = new TestIdentityProvider(new ServerIdentity(ServerId, _key, _clock.UtcNow));
    }

    public void Dispose() => _key.Dispose();

    private TrustApiClient Client(RecordingHandler handler, Action<TrustApiClientOptions>? configure = null, string baseUrl = "https://trust.example.org")
    {
        Assert.True(TrustApiClientOptions.TryNormalizeBaseUrl(baseUrl, false, out var uri, out _));
        var options = new TrustApiClientOptions(uri!, "1.0.0") { RetryDelay = TimeSpan.FromMilliseconds(1) };
        configure?.Invoke(options);
        return new TrustApiClient(options, _identities, _clock, new RecordingLogger(), handler, disposeHandler: false);
    }

    private const string CheckResponseJson = "{\"player\":{\"type\":\"steam\",\"id\":\"76561198000000001\",\"user_id\":\"76561198000000001@steam\",\"first_seen_at\":\"2026-01-01T00:00:00.000Z\"},\"global_status\":\"confirmed\",\"case_id\":\"CASE-2026-001337\",\"cases\":[{\"case_id\":\"CASE-2026-001337\",\"verdict\":\"confirmed\",\"status\":\"closed\",\"confirmed_servers\":3}],\"reports\":4,\"open_reports\":1,\"confirmed_servers\":3,\"independent_confirmed_servers\":2,\"account_age\":{\"days\":3,\"created_at\":\"2026-09-26T00:00:00.000Z\",\"source\":\"steam\"},\"vpn\":{\"detected\":true,\"confidence\":\"likely\",\"type\":\"vpn\"},\"bypass\":{\"active\":false,\"types\":[],\"bypasses\":[]},\"alt_account\":{\"possible\":true,\"confidence\":\"medium\",\"signals\":[\"same_network_identifier\",\"a_future_signal\"],\"linked_confirmed_cases\":[\"CASE-2026-000999\"]},\"policy_version\":3,\"checked_at\":\"2026-09-29T15:42:20.000Z\"}";

    /// <summary>Verifies a captured request exactly like the backend: canonical string from what was received.</summary>
    private void AssertValidSignature(CapturedRequest request)
    {
        var canonical = RequestCanonicalizer.Build(
            request.Method.Method,
            request.Uri.PathAndQuery,
            request.Header(SigningHeaderNames.ServerId)!,
            request.Header(SigningHeaderNames.Timestamp)!,
            request.Header(SigningHeaderNames.Nonce)!,
            request.Header(SigningHeaderNames.RequestId)!,
            Sha256.HashHex(request.Body));
        Assert.True(Ed25519Signer.VerifyBase64(_key.PublicKeyBase64, canonical, request.Header(SigningHeaderNames.Signature)), "signature must verify");
    }

    [Fact]
    public async Task Signed_post_carries_all_headers_and_a_valid_signature_over_the_sent_bytes()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.OK, CheckResponseJson);
        using var client = Client(handler);

        var response = await client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player, Nickname = "Foo", Ip = "203.0.113.4" });

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://trust.example.org/api/v1/player/check", request.Uri.ToString());
        Assert.Equal(ServerId, request.Header("X-Server-Id"));
        Assert.Equal("1790000000000", request.Header("X-Timestamp"));
        Assert.Matches("^[A-Za-z0-9_-]{24}$", request.Header("X-Nonce")!);
        Assert.Matches("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", request.Header("X-Request-Id")!);
        Assert.Equal(_key.Fingerprint, request.Header("X-Key-Fingerprint"));
        Assert.Equal("1.0.0", request.Header("X-Plugin-Version"));
        Assert.StartsWith("application/json", request.ContentType);
        AssertValidSignature(request);

        using var body = JsonDocument.Parse(request.Body);
        Assert.Equal("steam", body.RootElement.GetProperty("player").GetProperty("type").GetString());
        Assert.Equal("76561198000000001", body.RootElement.GetProperty("player").GetProperty("id").GetString());
        Assert.Equal("Foo", body.RootElement.GetProperty("nickname").GetString());
        Assert.False(body.RootElement.TryGetProperty("account_created_at", out _), "nulls are omitted");

        Assert.Equal("confirmed", response.GlobalStatus);
        Assert.Equal(3, response.AccountAge.Days);
        Assert.Contains("a_future_signal", response.AltAccount.Signals);
        Assert.Equal(1, _identities.SuccessCount);
    }

    [Fact]
    public async Task Get_policy_is_signed_without_body_or_content_type()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{\"version\":2,\"backend_unavailable_action\":\"allow\",\"notify_on_enforcement\":true,\"honor_global_bypasses\":false,\"whitelist_url\":null,\"rules\":[]}");
        using var client = Client(handler);

        var policy = await client.GetPolicyAsync();

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Empty(request.Body);
        Assert.Null(request.ContentType);
        AssertValidSignature(request);
        Assert.Equal(2, policy.Version);
    }

    [Fact]
    public async Task Base_path_prefix_is_part_of_the_signed_path()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{\"version\":1,\"rules\":[]}");
        using var client = Client(handler, baseUrl: "https://example.org/trust/api/v1/");

        await client.GetPolicyAsync();

        var request = Assert.Single(handler.Requests);
        Assert.Equal("/trust/api/v1/servers/policy", request.Uri.PathAndQuery);
        AssertValidSignature(request);
    }

    [Fact]
    public async Task Overwatch_heartbeat_sends_an_empty_object_to_the_session_path()
    {
        var sessionId = Guid.Parse("5B1D7E2A-8C4F-4A6B-9E3D-1F2A3B4C5D6E");
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{\"session_id\":\"5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e\",\"status\":\"active\",\"last_heartbeat_at\":\"2026-09-29T15:42:20.000Z\",\"server_time\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);

        await client.OverwatchHeartbeatAsync(sessionId);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("/api/v1/overwatch/sessions/5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e/heartbeat", request.Uri.PathAndQuery);
        Assert.Equal("{}", request.BodyText);
        AssertValidSignature(request);
    }

    [Fact]
    public async Task End_session_serializes_the_reason_in_snake_case()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{\"session_id\":\"5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e\",\"status\":\"ended\",\"ended_at\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);

        await client.EndOverwatchSessionAsync(Guid.NewGuid(), OverwatchEndReason.OverwatchDisabled);

        Assert.Equal("{\"reason\":\"overwatch_disabled\"}", Assert.Single(handler.Requests).BodyText);
    }

    [Fact]
    public async Task Overwatch_start_request_and_response()
    {
        var secret = Convert.ToBase64String(Enumerable.Range(0, 32).Select(i => (byte)i).ToArray());
        var handler = RecordingHandler.Json(HttpStatusCode.Created, "{\"session_id\":\"5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e\",\"secret\":\"" + secret + "\",\"interval_seconds\":10,\"started_at\":\"2026-09-29T15:42:20.000Z\",\"heartbeat_interval_seconds\":30,\"server_time\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);

        var response = await client.StartOverwatchSessionAsync(new OverwatchSessionStartRequest
        {
            TargetPlayer = Player,
            Spectator = new PlayerRef(PlayerIdType.Discord, "123456789012345678"),
            StartedAt = DateTimeOffset.Parse("2026-09-29T15:42:20.5Z"),
        });

        Assert.Equal(10, response.IntervalSeconds);
        Assert.Equal("{\"target_player\":{\"type\":\"steam\",\"id\":\"76561198000000001\"},\"spectator\":{\"type\":\"discord\",\"id\":\"123456789012345678\"},\"started_at\":\"2026-09-29T15:42:20.500Z\"}", Assert.Single(handler.Requests).BodyText);
    }

    [Theory]
    [InlineData("AAAA")]
    [InlineData("")]
    public async Task Overwatch_start_rejects_a_malformed_secret(string secret)
    {
        var handler = RecordingHandler.Json(HttpStatusCode.Created, "{\"session_id\":\"5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e\",\"secret\":\"" + secret + "\",\"interval_seconds\":10,\"started_at\":\"2026-09-29T15:42:20.000Z\",\"heartbeat_interval_seconds\":30,\"server_time\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.StartOverwatchSessionAsync(new OverwatchSessionStartRequest { TargetPlayer = Player, Spectator = new PlayerRef(PlayerIdType.Steam, "76561198000000002") }));
        Assert.Equal(TrustApiErrorKind.InvalidResponse, ex.Kind);
    }

    [Fact]
    public async Task Register_is_unsigned_and_carries_a_valid_proof_of_possession()
    {
        using var pending = Ed25519KeyPair.Generate();
        var handler = RecordingHandler.Json(HttpStatusCode.Created, "{\"server_id\":\"" + ServerId + "\",\"key_fingerprint\":\"" + pending.Fingerprint + "\",\"status\":\"active\",\"server_time\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);
        const string token = "sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI";

        var response = await client.RegisterAsync(token, pending, "14.1.3");

        Assert.Equal(ServerId, response.ServerId);
        var request = Assert.Single(handler.Requests);
        Assert.Null(request.Header("X-Signature"));
        Assert.Null(request.Header("X-Server-Id"));
        using var body = JsonDocument.Parse(request.Body);
        var root = body.RootElement;
        Assert.Equal(token, root.GetProperty("registration_token").GetString());
        Assert.Equal(pending.PublicKeyBase64, root.GetProperty("public_key").GetString());
        Assert.Equal("1.0.0", root.GetProperty("plugin_version").GetString());
        Assert.Equal("14.1.3", root.GetProperty("game_version").GetString());
        Assert.Equal(1_790_000_000_000, root.GetProperty("timestamp").GetInt64());
        var message = PopMessages.Registration(token, pending.PublicKeyBase64, 1_790_000_000_000);
        Assert.True(Ed25519Signer.VerifyBase64(pending.PublicKeyBase64, message, root.GetProperty("pop_signature").GetString()));
        Assert.DoesNotContain(Convert.ToBase64String(pending.ExportSeed()), request.BodyText);
    }

    [Fact]
    public async Task Register_rejects_a_response_for_another_key()
    {
        using var pending = Ed25519KeyPair.Generate();
        var handler = RecordingHandler.Json(HttpStatusCode.Created, "{\"server_id\":\"" + ServerId + "\",\"key_fingerprint\":\"" + _key.Fingerprint + "\",\"status\":\"active\",\"server_time\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.RegisterAsync("sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI", pending, null));
        Assert.Equal(TrustApiErrorKind.InvalidResponse, ex.Kind);
    }

    [Theory]
    [InlineData("sreg_short")]
    [InlineData("sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI\n")]
    [InlineData("")]
    public async Task Register_validates_the_token_before_sending(string token)
    {
        var handler = RecordingHandler.Json(HttpStatusCode.Created, "{}");
        using var client = Client(handler);
        using var pending = Ed25519KeyPair.Generate();
        await Assert.ThrowsAsync<ArgumentException>(() => client.RegisterAsync(token, pending, null));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Rotation_is_signed_with_the_current_key_and_pop_by_the_new_key()
    {
        using var newKey = Ed25519KeyPair.Generate();
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{\"key_fingerprint\":\"" + newKey.Fingerprint + "\",\"previous_key_fingerprint\":\"" + _key.Fingerprint + "\",\"previous_key_retiring_until\":\"2026-09-29T15:52:20.000Z\",\"server_time\":\"2026-09-29T15:42:20.000Z\"}");
        using var client = Client(handler);

        await client.RotateKeyAsync(newKey);

        var request = Assert.Single(handler.Requests);
        AssertValidSignature(request);
        using var body = JsonDocument.Parse(request.Body);
        var message = PopMessages.Rotation(ServerId, newKey.PublicKeyBase64, body.RootElement.GetProperty("timestamp").GetInt64());
        Assert.True(Ed25519Signer.VerifyBase64(newKey.PublicKeyBase64, message, body.RootElement.GetProperty("pop_signature").GetString()));
        Assert.False(Ed25519Signer.VerifyBase64(_key.PublicKeyBase64, message, body.RootElement.GetProperty("pop_signature").GetString()));
    }

    [Fact]
    public async Task Rotation_to_the_same_key_is_refused()
    {
        using var client = Client(RecordingHandler.Json(HttpStatusCode.OK, "{}"));
        await Assert.ThrowsAsync<ArgumentException>(() => client.RotateKeyAsync(_key));
    }

    [Fact]
    public async Task Error_body_is_parsed_into_code_status_and_request_id()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.Unauthorized, "{\"error\":{\"code\":\"INVALID_SIGNATURE\",\"message\":\"Request signature is invalid\",\"request_id\":\"11111111-2222-4333-8444-555555555555\"}}");
        using var client = Client(handler);

        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));

        Assert.Equal(TrustApiErrorKind.Http, ex.Kind);
        Assert.Equal(ApiErrorCodes.InvalidSignature, ex.Code);
        Assert.Equal(401, ex.StatusCode);
        Assert.Equal("11111111-2222-4333-8444-555555555555", ex.RequestId);
        Assert.True(ex.IsAuthenticationFailure);
        Assert.False(ex.IsTransient);
        Assert.Equal(0, _identities.SuccessCount);
    }

    [Fact]
    public async Task Non_json_gateway_error_is_transient_and_idempotent_calls_retry_with_fresh_signatures()
    {
        var handler = new RecordingHandler((_, attempt) => Task.FromResult(attempt == 1
            ? new HttpResponseMessage(HttpStatusCode.BadGateway) { Content = new StringContent("<html>bad gateway</html>") }
            : RecordingHandler.JsonResponse(HttpStatusCode.OK, "{\"version\":4,\"rules\":[]}")));
        using var client = Client(handler);

        var policy = await client.GetPolicyAsync();
        Assert.Equal(4, policy.Version);
        Assert.Equal(2, handler.Requests.Count);
        Assert.NotEqual(handler.Requests[0].Header("X-Nonce"), handler.Requests[1].Header("X-Nonce"));
        Assert.NotEqual(handler.Requests[0].Header("X-Request-Id"), handler.Requests[1].Header("X-Request-Id"));
        AssertValidSignature(handler.Requests[1]);
    }

    [Fact]
    public async Task Non_idempotent_calls_are_not_retried()
    {
        var handler = new RecordingHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
        using var client = Client(handler);
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));
        Assert.Equal(ApiErrorCodes.UnexpectedStatus, ex.Code);
        Assert.True(ex.IsTransient);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task Timeout_is_reported_as_timeout_and_retried_only_for_idempotent_calls()
    {
        var handler = new RecordingHandler(async (_, _) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10));
            return RecordingHandler.JsonResponse(HttpStatusCode.OK, "{}");
        });
        using var client = Client(handler, o => o.RequestTimeout = TimeSpan.FromMilliseconds(100));

        var check = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));
        Assert.Equal(TrustApiErrorKind.Timeout, check.Kind);
        Assert.Single(handler.Requests);

        var time = await Assert.ThrowsAsync<TrustApiException>(() => client.GetTimeAsync());
        Assert.Equal(TrustApiErrorKind.Timeout, time.Kind);
        Assert.Equal(3, handler.Requests.Count);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_reported_as_timeout()
    {
        var handler = new RecordingHandler(async (_, _) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10));
            return RecordingHandler.JsonResponse(HttpStatusCode.OK, "{}");
        });
        using var client = Client(handler);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }, cts.Token));
    }

    [Fact]
    public async Task Network_failure_is_reported_as_network_error()
    {
        var handler = new RecordingHandler((_, _) => throw new HttpRequestException("connection refused"));
        using var client = Client(handler);
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));
        Assert.Equal(TrustApiErrorKind.Network, ex.Kind);
        Assert.True(ex.IsTransient);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"global_status\":\"none\",\"account_age\":null,\"vpn\":{\"confidence\":\"not_detected\"},\"bypass\":{\"types\":[]},\"alt_account\":{\"confidence\":\"none\"}}")]
    [InlineData("{\"global_status\":\"\",\"account_age\":{},\"vpn\":{\"confidence\":\"not_detected\"},\"bypass\":{},\"alt_account\":{\"confidence\":\"none\"}}")]
    [InlineData("{\"global_status\":\"none\",\"reports\":-1,\"account_age\":{},\"vpn\":{\"confidence\":\"not_detected\"},\"bypass\":{},\"alt_account\":{\"confidence\":\"none\"}}")]
    [InlineData("{\"global_status\":\"none\",\"reports\":\"4\",\"account_age\":{},\"vpn\":{\"confidence\":\"x\"},\"bypass\":{},\"alt_account\":{\"confidence\":\"none\"}}")]
    public async Task Malformed_success_responses_are_rejected(string json)
    {
        using var client = Client(RecordingHandler.Json(HttpStatusCode.OK, json));
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));
        Assert.Equal(TrustApiErrorKind.InvalidResponse, ex.Kind);
    }

    [Fact]
    public async Task Missing_lists_are_normalized_to_empty()
    {
        using var client = Client(RecordingHandler.Json(HttpStatusCode.OK, "{\"global_status\":\"none\",\"account_age\":{\"days\":null},\"vpn\":{\"confidence\":\"not_detected\"},\"bypass\":{\"types\":null},\"alt_account\":{\"confidence\":\"none\",\"linked_confirmed_cases\":null}}"));
        var response = await client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player });
        Assert.Empty(response.Bypass.Types);
        Assert.Empty(response.AltAccount.LinkedConfirmedCases);
        Assert.Null(response.AccountAge.Days);
    }

    [Fact]
    public async Task Oversized_responses_are_rejected()
    {
        var huge = "{\"global_status\":\"" + new string('x', 2048) + "\"}";
        using var client = Client(RecordingHandler.Json(HttpStatusCode.OK, huge), o => o.MaxResponseBytes = 1024);
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));
        Assert.Equal(TrustApiErrorKind.InvalidResponse, ex.Kind);
    }

    [Fact]
    public async Task Signed_calls_fail_fast_when_not_registered()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{}");
        _identities.Identity = null;
        using var client = Client(handler);
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.GetPolicyAsync());
        Assert.Equal(TrustApiErrorKind.NotRegistered, ex.Kind);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Get_time_is_unsigned()
    {
        var handler = RecordingHandler.Json(HttpStatusCode.OK, "{\"server_time\":\"2026-09-29T15:42:20.000Z\",\"epoch_ms\":1790000000000}");
        _identities.Identity = null;
        using var client = Client(handler);
        var time = await client.GetTimeAsync();
        Assert.Equal(1_790_000_000_000, time.EpochMs);
        Assert.Null(Assert.Single(handler.Requests).Header("X-Signature"));
    }

    [Fact]
    public async Task Error_message_from_backend_is_sanitized_and_truncated()
    {
        var hostile = new string('A', 1000) + "\u0007\n";
        using var client = Client(RecordingHandler.Json(HttpStatusCode.BadRequest, "{\"error\":{\"code\":\"VALIDATION_FAILED\",\"message\":\"" + hostile.Replace("\u0007", "\\u0007").Replace("\n", "\\n") + "\"}}"));
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => client.CheckPlayerAsync(new PlayerCheckRequest { Player = Player }));
        Assert.True(ex.Message.Length <= 300);
        Assert.DoesNotContain('\u0007', ex.Message);
    }

    [Theory]
    [InlineData("https://trust.example.org", "https://trust.example.org/")]
    [InlineData("https://trust.example.org/api/v1", "https://trust.example.org/")]
    [InlineData("https://trust.example.org/api/v1/", "https://trust.example.org/")]
    [InlineData("https://example.org/trust/", "https://example.org/trust")]
    [InlineData("http://localhost:3000", "http://localhost:3000/")]
    [InlineData("http://127.0.0.1:3000/api/v1", "http://127.0.0.1:3000/")]
    [InlineData("http://[::1]:3000", "http://[::1]:3000/")]
    public void Base_url_normalization(string input, string expected)
    {
        Assert.True(TrustApiClientOptions.TryNormalizeBaseUrl(input, false, out var uri, out var error), error);
        Assert.Equal(expected, uri!.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("trust.example.org")]
    [InlineData("ftp://trust.example.org")]
    [InlineData("http://trust.example.org")]
    [InlineData("https://user:pass@trust.example.org")]
    [InlineData("https://trust.example.org/?x=1")]
    [InlineData("https://trust.example.org/#frag")]
    public void Unsafe_base_urls_are_rejected(string input)
    {
        Assert.False(TrustApiClientOptions.TryNormalizeBaseUrl(input, false, out _, out var error));
        Assert.False(string.IsNullOrEmpty(error));
    }

    [Fact]
    public void Plain_http_to_remote_hosts_requires_explicit_opt_in()
    {
        Assert.True(TrustApiClientOptions.TryNormalizeBaseUrl("http://backend:3000", allowInsecureHttp: true, out var uri, out _));
        Assert.Equal("http://backend:3000/", uri!.ToString());
    }

    private sealed class TestIdentityProvider : IServerIdentityProvider
    {
        public TestIdentityProvider(ServerIdentity identity) => Identity = identity;

        public ServerIdentity? Identity { get; set; }

        public int SuccessCount { get; private set; }

        public ServerIdentity? Current => Identity;

        public void OnSignedRequestSucceeded(ServerIdentity identity) => SuccessCount++;
    }
}
