using System.Text;
using System.Text.RegularExpressions;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Security;

public sealed class CanonicalizerAndSignerTests
{
    private const string ServerId = "srv_7k4x92m8pq174kf9";
    private const string Nonce = "UW8HA_cfo3gvtxatqwKOlN8q";
    private const string RequestId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

    private static string Build(string method = "GET", string path = "/api/v1/servers/policy", string serverId = ServerId, string timestamp = "1790000000000", string nonce = Nonce, string requestId = RequestId, string hash = Sha256.EmptyHex)
        => RequestCanonicalizer.Build(method, path, serverId, timestamp, nonce, requestId, hash);

    [Fact]
    public void Lowercase_method_is_upper_cased()
    {
        Assert.StartsWith("SCPSL-TRUST-V1\nPUT\n", Build(method: "put"));
    }

    [Fact]
    public void Canonical_string_has_eight_lines_and_no_trailing_newline()
    {
        var canonical = Build();
        Assert.Equal(8, canonical.Split('\n').Length);
        Assert.False(canonical.EndsWith("\n", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("/api/v1/x\n/evil")]
    [InlineData("/api/v1/x y")]
    [InlineData("/api/v1/x\t")]
    [InlineData("api/v1/no-leading-slash")]
    [InlineData("")]
    [InlineData("/api/v1/\u007f")]
    public void Path_injection_is_rejected(string path)
    {
        Assert.ThrowsAny<ArgumentException>(() => Build(path: path));
    }

    [Theory]
    [InlineData("srv_x\nPOST")]
    [InlineData("")]
    [InlineData("srv x")]
    public void Server_id_with_separators_is_rejected(string serverId)
    {
        Assert.ThrowsAny<ArgumentException>(() => Build(serverId: serverId));
    }

    [Theory]
    [InlineData("0123")]
    [InlineData("-1")]
    [InlineData("+1")]
    [InlineData("1.5")]
    [InlineData("1e3")]
    [InlineData("")]
    [InlineData("9007199254740992")]
    [InlineData("99999999999999999")]
    [InlineData(" 1")]
    public void Non_canonical_timestamps_are_rejected(string timestamp)
    {
        Assert.ThrowsAny<ArgumentException>(() => Build(timestamp: timestamp));
    }

    [Fact]
    public void Numeric_timestamp_bounds()
    {
        Assert.Equal("0", RequestCanonicalizer.FormatTimestamp(0));
        Assert.Equal("9007199254740991", RequestCanonicalizer.FormatTimestamp(RequestCanonicalizer.MaxSafeInteger));
        Assert.ThrowsAny<ArgumentException>(() => RequestCanonicalizer.FormatTimestamp(-1));
        Assert.ThrowsAny<ArgumentException>(() => RequestCanonicalizer.FormatTimestamp(RequestCanonicalizer.MaxSafeInteger + 1));
    }

    [Theory]
    [InlineData("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855")]
    [InlineData("e3b0")]
    [InlineData("zz")]
    public void Body_hash_must_be_lowercase_sha256_hex(string hash)
    {
        Assert.ThrowsAny<ArgumentException>(() => Build(hash: hash));
    }

    [Theory]
    [InlineData("GE T")]
    [InlineData("GET\n")]
    [InlineData("G3T")]
    [InlineData("")]
    [InlineData("VERYLONGMETHODNAME")]
    public void Invalid_methods_are_rejected(string method)
    {
        Assert.ThrowsAny<ArgumentException>(() => Build(method: method));
    }

    [Fact]
    public void Empty_nonce_or_request_id_is_rejected()
    {
        Assert.ThrowsAny<ArgumentException>(() => Build(nonce: ""));
        Assert.ThrowsAny<ArgumentException>(() => Build(requestId: ""));
        Assert.ThrowsAny<ArgumentException>(() => Build(requestId: "a b"));
    }

    [Fact]
    public void Signer_generates_fresh_nonce_request_id_and_clock_timestamp()
    {
        using var pair = Ed25519KeyPair.Generate();
        var identity = new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow);
        var clock = new FakeClock(DateTimeOffset.FromUnixTimeMilliseconds(1_790_000_123_456));
        var signer = new RequestSigner(clock, "1.0.0");
        var body = Encoding.UTF8.GetBytes("{\"a\":1}");

        var first = signer.Sign(identity, "POST", "/api/v1/player/check", body);
        var second = signer.Sign(identity, "POST", "/api/v1/player/check", body);

        Assert.Equal("1790000123456", first.Timestamp);
        Assert.Matches(new Regex("^[A-Za-z0-9_-]{24}$"), first.Nonce);
        Assert.Matches(new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"), first.RequestId);
        Assert.NotEqual(first.Nonce, second.Nonce);
        Assert.NotEqual(first.RequestId, second.RequestId);
        Assert.True(Ed25519Signer.VerifyBase64(pair.PublicKeyBase64, first.CanonicalRequest, first.Signature));
        Assert.EndsWith("\n" + Sha256.HashHex(body), first.CanonicalRequest);
    }

    [Fact]
    public void Signature_does_not_verify_after_body_change()
    {
        using var pair = Ed25519KeyPair.Generate();
        var identity = new ServerIdentity(ServerId, pair, DateTimeOffset.UtcNow);
        var signer = new RequestSigner(new FakeClock(DateTimeOffset.UtcNow), "1.0.0");
        var signed = signer.Sign(identity, "POST", "/api/v1/player/check", Encoding.UTF8.GetBytes("{\"a\":1}"));
        var tampered = RequestCanonicalizer.Build("POST", "/api/v1/player/check", ServerId, signed.Timestamp, signed.Nonce, signed.RequestId, Sha256.HashHex("{\"a\":2}"));
        Assert.False(Ed25519Signer.VerifyBase64(pair.PublicKeyBase64, tampered, signed.Signature));
    }

    [Fact]
    public void Signing_requires_a_registered_identity()
    {
        using var pair = Ed25519KeyPair.Generate();
        var pending = new ServerIdentity(null, pair, DateTimeOffset.UtcNow);
        var signer = new RequestSigner(new FakeClock(DateTimeOffset.UtcNow), "1.0.0");
        Assert.Throws<InvalidOperationException>(() => signer.Sign(pending, "GET", "/api/v1/servers/policy", Array.Empty<byte>()));
    }

    [Fact]
    public void Verify_rejects_malformed_inputs_without_throwing()
    {
        using var pair = Ed25519KeyPair.Generate();
        var signature = Ed25519Signer.SignToBase64(pair, "hello");
        Assert.True(Ed25519Signer.VerifyBase64(pair.PublicKeyBase64, "hello", signature));
        Assert.False(Ed25519Signer.VerifyBase64(pair.PublicKeyBase64, "hello", "not base64!"));
        Assert.False(Ed25519Signer.VerifyBase64(pair.PublicKeyBase64, "hello", Convert.ToBase64String(new byte[63])));
        Assert.False(Ed25519Signer.VerifyBase64("AAAA", "hello", signature));
        Assert.False(Ed25519Signer.VerifyBase64(null, "hello", signature));
        Assert.False(Ed25519Signer.VerifyBase64(pair.PublicKeyBase64, null, signature));
        Assert.False(Ed25519Signer.Verify(new byte[32], Encoding.UTF8.GetBytes("hello"), new byte[64]));
    }

    [Fact]
    public void Pop_messages_reject_separator_injection()
    {
        Assert.ThrowsAny<ArgumentException>(() => PopMessages.Registration("sreg_x\nfoo", "AAAA", 1));
        Assert.ThrowsAny<ArgumentException>(() => PopMessages.Rotation("srv_a b", "AAAA", 1));
        Assert.ThrowsAny<ArgumentException>(() => PopMessages.Rotation(ServerId, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => PopMessages.Registration("sreg_x", "AAAA", -5));
    }

    [Theory]
    [InlineData("srv_7k4x92m8pq174kf9", true)]
    [InlineData("srv_7k4x92m8pq174kfi", false)]
    [InlineData("srv_7K4X92M8PQ174KF9", false)]
    [InlineData("srv_7k4x92m8pq174kf", false)]
    [InlineData("srx_7k4x92m8pq174kf9", false)]
    public void Server_id_format(string value, bool valid)
    {
        Assert.Equal(valid, ServerIds.IsValid(value));
    }

    [Theory]
    [InlineData("sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI", true)]
    [InlineData("sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9Cy", false)]
    [InlineData("sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9Cy+", false)]
    [InlineData("SREG_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI", false)]
    public void Registration_token_format(string value, bool valid)
    {
        Assert.Equal(valid, RegistrationTokens.IsValid(value));
        Assert.DoesNotContain("Q1raRc97", RegistrationTokens.Redact(value));
    }

    [Fact]
    public void Strict_base64_rejects_non_canonical_encodings()
    {
        var bytes = new byte[32];
        bytes[31] = 1;
        var canonical = Convert.ToBase64String(bytes);
        Assert.True(StrictBase64.TryDecode(canonical, 32, out _));
        Assert.False(StrictBase64.TryDecode(canonical.TrimEnd('='), 32, out _));
        Assert.False(StrictBase64.TryDecode(canonical.Replace('A', '-'), 32, out _));
        Assert.False(StrictBase64.TryDecode(canonical.Substring(0, 42) + "B=", 32, out _)); // non-zero padding bits
        Assert.False(StrictBase64.TryDecode(Convert.ToBase64String(new byte[31]), 32, out _));
    }
}
