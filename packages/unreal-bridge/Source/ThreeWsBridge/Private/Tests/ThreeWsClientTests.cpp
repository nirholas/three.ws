// Copyright 2026 nirholas. Licensed under the Apache License, Version 2.0.
// Automation tests for the parts of FThreeWsClient that need no network:
// the public defaults a project can rely on, and the empty result shapes the
// callbacks hand back before a request completes. Run from the Session Frontend
// under Automation > ThreeWsBridge.

#include "Misc/AutomationTest.h"
#include "ThreeWsClient.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FThreeWsClientDefaultsTest, "ThreeWsBridge.Client.Defaults",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FThreeWsClientDefaultsTest::RunTest(const FString& Parameters)
{
	const FThreeWsClient Client;
	TestEqual(TEXT("anonymous generation targets the public site"), Client.BaseUrl, FString(TEXT("https://three.ws")));
	TestTrue(TEXT("no BYOK provider key is set by default"), Client.ProviderKey.IsEmpty());
	TestTrue(TEXT("the request timeout allows server-side lane failover"), Client.RequestTimeoutSeconds >= 60.0f);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FThreeWsResultShapesTest, "ThreeWsBridge.Client.ResultShapes",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FThreeWsResultShapesTest::RunTest(const FString& Parameters)
{
	const FForgeJobResult Job;
	TestFalse(TEXT("a fresh job result is not ok"), Job.bOk);
	TestTrue(TEXT("a fresh job result has no job id"), Job.JobId.IsEmpty());
	TestTrue(TEXT("a fresh job result has no GLB url"), Job.GlbUrl.IsEmpty());

	const FForgeDownloadResult Download;
	TestFalse(TEXT("a fresh download result is not ok"), Download.bOk);
	TestEqual(TEXT("a fresh download result has no bytes"), Download.Bytes, static_cast<int64>(0));
	return true;
}

#endif
