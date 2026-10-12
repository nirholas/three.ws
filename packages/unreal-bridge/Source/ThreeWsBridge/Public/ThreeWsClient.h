// Real HTTP client for the public three.ws Forge pipeline (/api/forge).
// Implements specs/ENGINE_BRIDGE.md: auth-free generation, catalog browse,
// text/image submit, poll-to-completion, and GLB download. No glTF parsing
// lives here: ThreeWsForgeImporter hands the downloaded bytes to Unreal's
// own Interchange glTF pipeline.
//
// Mirrors the contract packages/unity-bridge and packages/godot-bridge
// implement in their own languages.
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Interfaces/IHttpRequest.h"

struct THREEWSBRIDGE_API FForgeJobResult
{
	bool bOk = false;
	FString JobId;
	FString Status;
	FString GlbUrl;
	FString Backend;
	FString Error;
};

struct THREEWSBRIDGE_API FForgeDownloadResult
{
	bool bOk = false;
	FString FilePath;
	int64 Bytes = 0;
	FString Error;
};

/**
 * One client per logical session. Generation is anonymous by default: an
 * x-forge-client handle is generated per instance. Set ProviderKey to use a
 * BYOK geometry provider key instead of the free-tier lane (spec section 1).
 */
class THREEWSBRIDGE_API FThreeWsClient : public TSharedFromThis<FThreeWsClient>
{
public:
	FThreeWsClient();

	FString BaseUrl = TEXT("https://three.ws");
	FString ProviderKey;
	// 60s, not 30s: a submit can retry across several lanes server-side
	// (free-first routing + failover) before it responds.
	float RequestTimeoutSeconds = 60.0f;

	/** GET /api/forge?catalog=1, the live tier/backend/cost matrix. */
	void GetCatalog(TFunction<void(bool bOk, TSharedPtr<FJsonObject> Body)> OnComplete);

	/** GET /api/forge?health=1, live per-lane up/down status. */
	void GetHealth(TFunction<void(bool bOk, TSharedPtr<FJsonObject> Body)> OnComplete);

	/** POST /api/forge-upload, then PUT the bytes. Calls back with the public URL. */
	void UploadReferenceImage(const TArray<uint8>& Bytes, const FString& ContentType,
		TFunction<void(bool bOk, FString PublicUrl, FString Error)> OnComplete);

	/** POST /api/forge with a text prompt. */
	void SubmitText(const FString& Prompt, const FString& Tier, const FString& Path,
		const FString& Backend, const FString& AspectRatio,
		TFunction<void(FForgeJobResult)> OnComplete);

	/** POST /api/forge with one or more public https image URLs. */
	void SubmitImage(const TArray<FString>& ImageUrls, const FString& Prompt, const FString& Tier,
		const FString& Path, const FString& Backend,
		TFunction<void(FForgeJobResult)> OnComplete);

	/**
	 * Poll GET /api/forge?job=<id> until done or failed, or TimeoutSeconds
	 * elapses. Keeps polling the SAME job id throughout: poll-time failover
	 * is server-side. Uses the core ticker, not a UWorld timer, so this
	 * works from editor-only code with no active PIE session.
	 */
	void WaitForGlb(const FString& JobId, float TimeoutSeconds, TFunction<void(FForgeJobResult)> OnComplete);

	/** Stream a generated GLB to a local absolute path. */
	void DownloadGlb(const FString& Url, const FString& DestinationPath,
		TFunction<void(FForgeDownloadResult)> OnComplete);

private:
	FString ClientHandle;

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> BuildRequest(const FString& Path, const FString& Verb) const;
	void SubmitInternal(TSharedPtr<FJsonObject> Body, TFunction<void(FForgeJobResult)> OnComplete);
};
