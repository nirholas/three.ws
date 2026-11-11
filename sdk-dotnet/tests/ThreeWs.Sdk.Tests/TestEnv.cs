using System;
using System.Reflection;
using Xunit;
using Xunit.Abstractions;

namespace ThreeWs.Sdk.Tests
{
    internal static class TestEnv
    {
        /// <summary>A real three.ws API key for the authenticated paths, when the runner has one.</summary>
        public static string? ApiKey => Environment.GetEnvironmentVariable("THREE_WS_API_KEY") is { Length: > 0 } k ? k : null;

        public static Uri BaseUrl => new Uri(Environment.GetEnvironmentVariable("THREE_WS_BASE_URL") ?? "https://three.ws");

        public static ThreeWsClient Anonymous() => new ThreeWsClient(new ThreeWsClientOptions { BaseUrl = BaseUrl, UserAgentSuffix = "sdk-tests" });

        public static ThreeWsClient Authenticated() => new ThreeWsClient(new ThreeWsClientOptions { BaseUrl = BaseUrl, ApiKey = ApiKey, UserAgentSuffix = "sdk-tests" });

        /// <summary>Which SDK binary this run loaded: the framework it was compiled for.</summary>
        public static string SdkFramework =>
            typeof(ThreeWsClient).Assembly.GetCustomAttribute<System.Runtime.Versioning.TargetFrameworkAttribute>()?.FrameworkName ?? "unknown";
    }

    public class SdkBinaryTests
    {
        private readonly ITestOutputHelper _out;
        public SdkBinaryTests(ITestOutputHelper output) => _out = output;

        [Fact]
        public void ReportsWhichSdkTargetIsUnderTest()
        {
            _out.WriteLine("SDK under test: " + TestEnv.SdkFramework);
            Assert.Contains(Environment.GetEnvironmentVariable("EXPECT_SDK_TFM") ?? "", TestEnv.SdkFramework);
        }
    }
}
