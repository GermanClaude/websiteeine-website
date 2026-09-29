using System.Text.Json;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Tests.Support;
using Xunit;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace ScpslTrust.Core.Tests.Policy;

/// <summary>Every case of shared/test-vectors/policy.json must produce the identical decision.</summary>
public sealed class PolicyVectorTests
{
    private const string File = "policy.json";

    public static IEnumerable<object[]> CaseNames => TestVectors.CaseNames(File, "cases");

    [Fact]
    public void Vector_file_has_all_cases()
    {
        Assert.Equal(58, TestVectors.Load(File).GetProperty("cases").GetArrayLength());
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Case_produces_expected_decision(string name)
    {
        var c = TestVectors.Case(File, "cases", name);
        var policy = TrustJson.Deserialize<ServerPolicy>(c.GetProperty("policy").GetRawText())!;
        var decision = Evaluate(c, policy);
        AssertDecision(c.GetProperty("expected_decision"), decision);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Case_expected_summary_matches(string name)
    {
        var c = TestVectors.Case(File, "cases", name);
        var policy = TrustJson.Deserialize<ServerPolicy>(c.GetProperty("policy").GetRawText())!;
        var decision = Evaluate(c, policy);
        var expected = c.GetProperty("expected");
        Assert.Equal(expected.Str("action"), PolicyActions.ToWire(decision.Action));
        Assert.Equal(expected.GetProperty("applied_rule_ids").EnumerateArray().Select(e => e.GetString()), decision.Applied.Select(o => o.RuleId));
        Assert.Equal(expected.GetProperty("bypassed_rule_ids").EnumerateArray().Select(e => e.GetString()), decision.Bypassed.Select(o => o.RuleId));
    }

    /// <summary>The same policy loaded through LabAPI-style YAML (local_policy) must decide identically.</summary>
    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Case_decides_identically_after_yaml_round_trip(string name)
    {
        var c = TestVectors.Case(File, "cases", name);
        var policy = TrustJson.Deserialize<ServerPolicy>(c.GetProperty("policy").GetRawText())!;
        var serializer = new SerializerBuilder().WithNamingConvention(UnderscoredNamingConvention.Instance).DisableAliases().Build();
        var deserializer = new DeserializerBuilder().WithNamingConvention(UnderscoredNamingConvention.Instance).IgnoreUnmatchedProperties().Build();
        var yaml = serializer.Serialize(policy);
        var reloaded = deserializer.Deserialize<ServerPolicy>(yaml);
        AssertDecision(c.GetProperty("expected_decision"), Evaluate(c, reloaded));
    }

    [Fact]
    public void Default_policy_matches_the_vectors_default_policy()
    {
        var c = TestVectors.Case(File, "cases", "default_policy_all_signals");
        var vectorPolicy = c.GetProperty("policy");
        var ours = JsonDocument.Parse(TrustJson.Serialize(DefaultPolicy.Build())).RootElement;
        // The vectors carry a whitelist_url for placeholder tests; everything else must be identical.
        Assert.Equal(vectorPolicy.GetProperty("rules").GetArrayLength(), ours.GetProperty("rules").GetArrayLength());
        foreach (var (expected, actual) in vectorPolicy.GetProperty("rules").EnumerateArray().Zip(ours.GetProperty("rules").EnumerateArray()))
        {
            foreach (var property in expected.EnumerateObject().Where(p => p.Value.ValueKind != JsonValueKind.Null))
            {
                Assert.True(actual.TryGetProperty(property.Name, out var value), property.Name);
                Assert.True(TestVectors.JsonEquals(property.Value, value), property.Name);
            }
        }

        Assert.Equal("allow", ours.Str("backend_unavailable_action"));
        Assert.True(ours.GetProperty("notify_on_enforcement").GetBoolean());
        Assert.False(ours.GetProperty("honor_global_bypasses").GetBoolean());
    }

    private static PolicyDecision Evaluate(JsonElement c, ServerPolicy policy)
    {
        // The engine input is the subset of a /player/check response; parse it through the real DTO.
        var response = TrustJson.Deserialize<PlayerCheckResponse>(c.GetProperty("input").GetRawText())!;
        var input = PolicyEvaluationInput.FromCheckResponse(response);
        var context = c.GetProperty("context");
        var serverName = context.TryGetProperty("server_name", out var sn) ? sn.GetString() : null;
        return PolicyEngine.Evaluate(input, policy, new PolicyEvaluationContext(serverName));
    }

    private static void AssertDecision(JsonElement expected, PolicyDecision decision)
    {
        Assert.Equal(expected.Str("action"), PolicyActions.ToWire(decision.Action));
        AssertOutcomes(expected.GetProperty("applied"), decision.Applied);
        AssertOutcomes(expected.GetProperty("bypassed"), decision.Bypassed);
        Assert.Equal(expected.GetProperty("notify_admins").GetBoolean(), decision.NotifyAdmins);
        Assert.Equal(expected.NullableStr("message"), decision.Message);
        var ban = expected.GetProperty("ban_duration_minutes");
        Assert.Equal(ban.ValueKind == JsonValueKind.Null ? null : ban.GetInt32(), decision.BanDurationMinutes);
    }

    private static void AssertOutcomes(JsonElement expected, IReadOnlyList<PolicyRuleOutcome> actual)
    {
        var expectedList = expected.EnumerateArray().ToList();
        Assert.Equal(expectedList.Count, actual.Count);
        for (var i = 0; i < expectedList.Count; i++)
        {
            Assert.Equal(expectedList[i].Str("rule_id"), actual[i].RuleId);
            Assert.Equal(expectedList[i].Str("signal"), PolicySignals.ToWire(actual[i].Signal));
            Assert.Equal(expectedList[i].Str("action"), PolicyActions.ToWire(actual[i].Action));
            Assert.Equal(expectedList[i].Str("reason_code"), PolicyReasonCodes.ToWire(actual[i].ReasonCode));
        }
    }
}
