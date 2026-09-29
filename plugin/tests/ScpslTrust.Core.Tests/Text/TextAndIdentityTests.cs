using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Reports;
using ScpslTrust.Core.Services;
using ScpslTrust.Core.Tests.Support;
using ScpslTrust.Core.Text;
using Xunit;

namespace ScpslTrust.Core.Tests.Text;

public sealed class TextAndIdentityTests
{
    [Theory]
    [InlineData("76561198000000001@steam", PlayerIdType.Steam, "76561198000000001")]
    [InlineData("76561198000000001%40steam", PlayerIdType.Steam, "76561198000000001")]
    [InlineData("123456789012345678@discord", PlayerIdType.Discord, "123456789012345678")]
    [InlineData("some.name-1_x@northwood", PlayerIdType.Northwood, "some.name-1_x")]
    public void Valid_user_ids_parse(string value, PlayerIdType type, string id)
    {
        Assert.True(PlayerRef.TryParseUserId(value, out var player));
        Assert.Equal(type, player!.Type);
        Assert.Equal(id, player.Id);
        Assert.Equal(id + "@" + PlayerRef.TypeName(type), player.ToUserId());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("76561198000000001")]
    [InlineData("7656119800000000@steam")]
    [InlineData("765611980000000011@steam")]
    [InlineData("76561198000000001@Steam")]
    [InlineData("76561198000000001@steam@steam")]
    [InlineData("@steam")]
    [InlineData("abc@steam")]
    [InlineData("١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧@steam")]
    [InlineData("Upper@northwood")]
    [InlineData("76561198000000001@localhost")]
    [InlineData("76561198000000001@patreon")]
    public void Invalid_user_ids_are_rejected(string? value)
    {
        Assert.False(PlayerRef.TryParseUserId(value, out _));
    }

    [Fact]
    public void Player_ref_constructor_validates()
    {
        Assert.Throws<ArgumentException>(() => new PlayerRef(PlayerIdType.Steam, "123"));
        Assert.Throws<ArgumentException>(() => new PlayerRef(PlayerIdType.Northwood, new string('a', 65)));
        Assert.Equal(new PlayerRef(PlayerIdType.Steam, "76561198000000001"), new PlayerRef(PlayerIdType.Steam, "76561198000000001"));
    }

    [Fact]
    public void Player_ref_serializes_as_type_and_id()
    {
        Assert.Equal("{\"type\":\"northwood\",\"id\":\"abc\"}", TrustJson.Serialize(new PlayerRef(PlayerIdType.Northwood, "abc")));
    }

    [Theory]
    [InlineData("203.0.113.4", "203.0.113.4", "203.0.113.x")]
    [InlineData("::ffff:203.0.113.4", "203.0.113.4", "203.0.113.x")]
    [InlineData("2001:db8:1:2::5", "2001:db8:1:2::5", "2001:db8:1::/48")]
    [InlineData("fe80::1%2", "fe80::1", "fe80:0:0::/48")]
    public void Ip_normalization_and_masking(string input, string normalized, string masked)
    {
        Assert.Equal(normalized, IpAddresses.Normalize(input));
        Assert.Equal(masked, IpAddresses.Mask(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("localhost")]
    [InlineData("203.0.113.4; rm -rf /")]
    public void Invalid_ips_normalize_to_null(string? input)
    {
        Assert.Null(IpAddresses.Normalize(input));
        Assert.Equal("invalid-ip", IpAddresses.Mask(input));
    }

    [Fact]
    public void Sanitizer_behaviour()
    {
        Assert.Null(TextSanitizer.ToNickname("   \n\t "));
        Assert.Equal("a b", TextSanitizer.ToNickname(" a\r\n\u0007 b "));
        Assert.Equal("Red", TextSanitizer.StripRichText("<color=red>Red</color>"));
        Assert.Equal("＜b＞x＜/b＞", TextSanitizer.EscapeRichText("<b>x</b>"));
        var emoji = new string('a', 63) + "😀";
        Assert.Equal(new string('a', 63), TextSanitizer.Truncate(emoji, 64));
        Assert.Equal("line1\nline2", TextSanitizer.CleanMultiline("line1\r\nline2\u0000", 100));
    }

    [Theory]
    [InlineData("LNK-7K4X92", "LNK-7K4X92")]
    [InlineData("lnk-7k4x92", "LNK-7K4X92")]
    [InlineData(" 7k4x92 ", "LNK-7K4X92")]
    public void Link_codes_normalize(string input, string expected)
    {
        Assert.True(LinkCodes.TryNormalize(input, out var code));
        Assert.Equal(expected, code);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("LNK-7K4X9")]
    [InlineData("LNK-7K4X9I")]
    [InlineData("LNK-7K4X92X")]
    [InlineData("LNK-7K4X92; drop")]
    [InlineData("LNK_7K4X92")]
    public void Invalid_link_codes_are_rejected(string? input)
    {
        Assert.False(LinkCodes.TryNormalize(input, out _));
    }

    [Fact]
    public void Report_factory_rejects_self_reports_and_normalizes_text()
    {
        var target = new PlayerRef(PlayerIdType.Steam, "76561198000000001");
        var reporter = new PlayerRef(PlayerIdType.Steam, "76561198000000002");
        Assert.Null(InGameReportFactory.Create(InGameReportKind.Cheater, target, "t", target, "t", "aimbot", null));

        var report = InGameReportFactory.Create(InGameReportKind.Cheater, target, "<color=red>Bad</color>", reporter, "Rep\norter", "<b>a</b>", "<size=40>My Server</size>")!;
        Assert.Equal("In-game cheater report (no reason given)", report.Reason);
        Assert.Contains("Reported player nickname: Bad", report.Description);
        Assert.Contains("Reporter nickname: Rep orter", report.Description);
        Assert.Contains("Server: My Server", report.Description);

        var longReason = InGameReportFactory.Create(InGameReportKind.Player, target, null, null, null, new string('r', 500), null)!;
        Assert.Equal(200, longReason.Reason.Length);
        Assert.Null(longReason.Reporter);
    }

    [Fact]
    public void Report_throttle_blocks_duplicates_and_floods()
    {
        var clock = new FakeClock(DateTimeOffset.UnixEpoch.AddYears(56));
        var throttle = ReportThrottle.CreateDefault(clock);
        var reporter = new PlayerRef(PlayerIdType.Steam, "76561198000000002");
        var targets = Enumerable.Range(10, 7).Select(i => new PlayerRef(PlayerIdType.Steam, "765611980000000" + i)).ToList();

        Assert.True(throttle.TryAcquire(reporter, targets[0]));
        Assert.False(throttle.TryAcquire(reporter, targets[0]));
        for (var i = 1; i < 5; i++)
        {
            Assert.True(throttle.TryAcquire(reporter, targets[i]));
        }

        Assert.False(throttle.TryAcquire(reporter, targets[5]));
        Assert.True(throttle.TryAcquire(new PlayerRef(PlayerIdType.Steam, "76561198000000003"), targets[5]));

        clock.Advance(TimeSpan.FromMinutes(11));
        Assert.False(throttle.TryAcquire(reporter, targets[6]));
        clock.Advance(TimeSpan.FromHours(1));
        Assert.True(throttle.TryAcquire(reporter, targets[0]));
    }

    [Fact]
    public async Task Periodic_scheduler_runs_jobs_and_survives_failures()
    {
        using var scheduler = new PeriodicScheduler(new RecordingLogger());
        var runs = 0;
        var failures = 0;
        scheduler.Add("ok", TimeSpan.FromMilliseconds(10), TimeSpan.Zero, _ =>
        {
            Interlocked.Increment(ref runs);
            return Task.CompletedTask;
        });
        scheduler.Add("fails", TimeSpan.FromMilliseconds(10), TimeSpan.Zero, _ =>
        {
            Interlocked.Increment(ref failures);
            throw new InvalidOperationException("boom");
        });
        scheduler.Start();
        Assert.Throws<InvalidOperationException>(() => scheduler.Add("late", TimeSpan.FromSeconds(1), TimeSpan.Zero, _ => Task.CompletedTask));
        for (var i = 0; i < 100 && (Volatile.Read(ref runs) < 3 || Volatile.Read(ref failures) < 3); i++)
        {
            await Task.Delay(10);
        }

        scheduler.Stop(TimeSpan.FromSeconds(2));
        Assert.True(runs >= 3);
        Assert.True(failures >= 3);
        var after = runs;
        await Task.Delay(50);
        Assert.Equal(after, runs);
    }

    [Fact]
    public async Task Invoke_async_marshals_results_and_exceptions()
    {
        Assert.Equal(42, await InlineMainThreadDispatcher.Instance.InvokeAsync(() => 42));
        await Assert.ThrowsAsync<InvalidOperationException>(() => InlineMainThreadDispatcher.Instance.InvokeAsync(() => throw new InvalidOperationException()));
    }
}
