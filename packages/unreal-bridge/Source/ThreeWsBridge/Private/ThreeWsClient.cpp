#include "ThreeWsClient.h"

#include "Containers/Ticker.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HttpModule.h"
#include "Dom/JsonValue.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace
{
	const FString BridgeVersion = TEXT("0.1.0");
	constexpr float PollIntervalSeconds = 2.5f;

	FString SerializeJson(const TSharedRef<FJsonObject>& Object)
	{
		FString Out;
		TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Out);
		FJsonSerializer::Serialize(Object, Writer);
		return Out;
	}

	TSharedPtr<FJsonObject> ParseJsonOrEmpty(const FString& Text)
	{
		TSharedPtr<FJsonObject> Parsed = MakeShared<FJsonObject>();
		if (!Text.IsEmpty())
		{
			TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
			TSharedPtr<FJsonObject> Candidate;
			if (FJsonSerializer::Deserialize(Reader, Candidate) && Candidate.IsValid())
			{
				Parsed = Candidate;
			}
		}
		return Parsed;
	}

	// Self-contained SHA-256 (FIPS 180-4). Engine's own "SHA" helpers
	// (FSHA1 / FSHAHash) are SHA-1, not SHA-256, so the presign endpoint's
	// checksum_sha256 field needs its own implementation here rather than a
	// mismatched engine type.
	FString Sha256Hex(const TArray<uint8>& Data)
	{
		static const uint32 K[64] = {
			0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
			0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
			0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
			0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
			0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
			0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
			0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
			0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
		};
		uint32 H[8] = {
			0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
			0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
		};

		TArray<uint8> Msg(Data);
		const uint64 BitLen = (uint64)Data.Num() * 8;
		Msg.Add(0x80);
		while (Msg.Num() % 64 != 56)
		{
			Msg.Add(0x00);
		}
		for (int32 i = 7; i >= 0; i--)
		{
			Msg.Add((uint8)((BitLen >> (i * 8)) & 0xff));
		}

		auto Rotr = [](uint32 X, uint32 N) { return (X >> N) | (X << (32 - N)); };

		for (int32 Chunk = 0; Chunk < Msg.Num(); Chunk += 64)
		{
			uint32 W[64];
			for (int32 i = 0; i < 16; i++)
			{
				W[i] = (Msg[Chunk + i * 4] << 24) | (Msg[Chunk + i * 4 + 1] << 16) |
					(Msg[Chunk + i * 4 + 2] << 8) | (Msg[Chunk + i * 4 + 3]);
			}
			for (int32 i = 16; i < 64; i++)
			{
				const uint32 S0 = Rotr(W[i - 15], 7) ^ Rotr(W[i - 15], 18) ^ (W[i - 15] >> 3);
				const uint32 S1 = Rotr(W[i - 2], 17) ^ Rotr(W[i - 2], 19) ^ (W[i - 2] >> 10);
				W[i] = W[i - 16] + S0 + W[i - 7] + S1;
			}

			uint32 A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], F = H[5], G = H[6], Hh = H[7];
			for (int32 i = 0; i < 64; i++)
			{
				const uint32 S1 = Rotr(E, 6) ^ Rotr(E, 11) ^ Rotr(E, 25);
				const uint32 Ch = (E & F) ^ ((~E) & G);
				const uint32 Temp1 = Hh + S1 + Ch + K[i] + W[i];
				const uint32 S0 = Rotr(A, 2) ^ Rotr(A, 13) ^ Rotr(A, 22);
				const uint32 Maj = (A & B) ^ (A & C) ^ (B & C);
				const uint32 Temp2 = S0 + Maj;
				Hh = G; G = F; F = E; E = D + Temp1;
				D = C; C = B; B = A; A = Temp1 + Temp2;
			}
			H[0] += A; H[1] += B; H[2] += C; H[3] += D;
			H[4] += E; H[5] += F; H[6] += G; H[7] += Hh;
		}

		FString Out;
		for (uint32 Word : H)
		{
			Out += FString::Printf(TEXT("%08x"), Word);
		}
		return Out;
	}
}

FThreeWsClient::FThreeWsClient()
{
	ClientHandle = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens);
}

TSharedRef<IHttpRequest, ESPMode::ThreadSafe> FThreeWsClient::BuildRequest(const FString& Path, const FString& Verb) const
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl + Path);
	Request->SetVerb(Verb);
	Request->SetTimeout(RequestTimeoutSeconds);
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetHeader(TEXT("x-forge-client"), ClientHandle);
	Request->SetHeader(TEXT("x-engine-bridge"), TEXT("unreal/") + BridgeVersion);
	Request->SetHeader(TEXT("User-Agent"), TEXT("three-ws-unreal-bridge/") + BridgeVersion);
	if (!ProviderKey.IsEmpty())
	{
		Request->SetHeader(TEXT("x-forge-provider-key"), ProviderKey);
	}
	return Request;
}

void FThreeWsClient::GetCatalog(TFunction<void(bool, TSharedPtr<FJsonObject>)> OnComplete)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = BuildRequest(TEXT("/api/forge?catalog=1"), TEXT("GET"));
	Request->OnProcessRequestComplete().BindLambda(
		[OnComplete](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
		{
			const bool bOk = bConnectedSuccessfully && Response.IsValid() &&
				EHttpResponseCodes::IsOk(Response->GetResponseCode());
			OnComplete(bOk, Response.IsValid() ? ParseJsonOrEmpty(Response->GetContentAsString()) : MakeShared<FJsonObject>());
		});
	Request->ProcessRequest();
}

void FThreeWsClient::GetHealth(TFunction<void(bool, TSharedPtr<FJsonObject>)> OnComplete)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = BuildRequest(TEXT("/api/forge?health=1"), TEXT("GET"));
	Request->OnProcessRequestComplete().BindLambda(
		[OnComplete](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
		{
			const bool bOk = bConnectedSuccessfully && Response.IsValid() &&
				EHttpResponseCodes::IsOk(Response->GetResponseCode());
			OnComplete(bOk, Response.IsValid() ? ParseJsonOrEmpty(Response->GetContentAsString()) : MakeShared<FJsonObject>());
		});
	Request->ProcessRequest();
}

void FThreeWsClient::UploadReferenceImage(const TArray<uint8>& Bytes, const FString& ContentType,
	TFunction<void(bool, FString, FString)> OnComplete)
{
	TSharedRef<FJsonObject> PresignBody = MakeShared<FJsonObject>();
	PresignBody->SetStringField(TEXT("content_type"), ContentType);
	PresignBody->SetNumberField(TEXT("size_bytes"), Bytes.Num());
	PresignBody->SetStringField(TEXT("checksum_sha256"), Sha256Hex(Bytes));

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Presign = BuildRequest(TEXT("/api/forge-upload"), TEXT("POST"));
	Presign->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Presign->SetContentAsString(SerializeJson(PresignBody));

	TWeakPtr<FThreeWsClient> WeakThis = AsShared();
	Presign->OnProcessRequestComplete().BindLambda(
		[this, WeakThis, Bytes, ContentType, OnComplete](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
		{
			if (!WeakThis.IsValid())
			{
				return;
			}
			if (!bConnectedSuccessfully || !Response.IsValid() || !EHttpResponseCodes::IsOk(Response->GetResponseCode()))
			{
				TSharedPtr<FJsonObject> Body = Response.IsValid() ? ParseJsonOrEmpty(Response->GetContentAsString()) : MakeShared<FJsonObject>();
				FString Message;
				if (!Body->TryGetStringField(TEXT("message"), Message))
				{
					Message = TEXT("This deployment has no object storage configured. Pass a public https image URL instead.");
				}
				OnComplete(false, TEXT(""), Message);
				return;
			}

			TSharedPtr<FJsonObject> Presigned = ParseJsonOrEmpty(Response->GetContentAsString());
			FString UploadUrl, PublicUrl;
			if (!Presigned->TryGetStringField(TEXT("upload_url"), UploadUrl) ||
				!Presigned->TryGetStringField(TEXT("public_url"), PublicUrl))
			{
				OnComplete(false, TEXT(""), TEXT("Presign response was missing upload_url or public_url."));
				return;
			}

			TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Put = FHttpModule::Get().CreateRequest();
			Put->SetURL(UploadUrl);
			Put->SetVerb(TEXT("PUT"));
			Put->SetContent(Bytes);

			const TSharedPtr<FJsonObject>* HeaderMap = nullptr;
			if (Presigned->TryGetObjectField(TEXT("headers"), HeaderMap) && HeaderMap && HeaderMap->IsValid())
			{
				for (const auto& Pair : (*HeaderMap)->Values)
				{
					Put->SetHeader(Pair.Key, Pair.Value->AsString());
				}
			}
			else
			{
				Put->SetHeader(TEXT("Content-Type"), ContentType);
			}

			Put->OnProcessRequestComplete().BindLambda(
				[PublicUrl, OnComplete](FHttpRequestPtr, FHttpResponsePtr PutResponse, bool bPutConnected)
				{
					const bool bPutOk = bPutConnected && PutResponse.IsValid() &&
						EHttpResponseCodes::IsOk(PutResponse->GetResponseCode());
					if (!bPutOk)
					{
						const int32 Code = PutResponse.IsValid() ? PutResponse->GetResponseCode() : 0;
						OnComplete(false, TEXT(""), FString::Printf(TEXT("uploading the reference image failed with HTTP %d"), Code));
						return;
					}
					OnComplete(true, PublicUrl, TEXT(""));
				});
			Put->ProcessRequest();
		});
	Presign->ProcessRequest();
}

void FThreeWsClient::SubmitText(const FString& Prompt, const FString& Tier, const FString& Path,
	const FString& Backend, const FString& AspectRatio, TFunction<void(FForgeJobResult)> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("prompt"), Prompt);
	Body->SetStringField(TEXT("tier"), Tier.IsEmpty() ? TEXT("standard") : Tier);
	Body->SetStringField(TEXT("path"), Path.IsEmpty() ? TEXT("image") : Path);
	Body->SetStringField(TEXT("aspect_ratio"), AspectRatio.IsEmpty() ? TEXT("1:1") : AspectRatio);
	if (!Backend.IsEmpty())
	{
		Body->SetStringField(TEXT("backend"), Backend);
	}
	SubmitInternal(Body, OnComplete);
}

void FThreeWsClient::SubmitImage(const TArray<FString>& ImageUrls, const FString& Prompt, const FString& Tier,
	const FString& Path, const FString& Backend, TFunction<void(FForgeJobResult)> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> UrlValues;
	for (const FString& Url : ImageUrls)
	{
		UrlValues.Add(MakeShared<FJsonValueString>(Url));
	}
	Body->SetArrayField(TEXT("image_urls"), UrlValues);
	Body->SetStringField(TEXT("tier"), Tier.IsEmpty() ? TEXT("standard") : Tier);
	Body->SetStringField(TEXT("path"), Path.IsEmpty() ? TEXT("image") : Path);
	if (!Prompt.IsEmpty())
	{
		Body->SetStringField(TEXT("prompt"), Prompt);
	}
	if (!Backend.IsEmpty())
	{
		Body->SetStringField(TEXT("backend"), Backend);
	}
	SubmitInternal(Body, OnComplete);
}

void FThreeWsClient::SubmitInternal(TSharedPtr<FJsonObject> Body, TFunction<void(FForgeJobResult)> OnComplete)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = BuildRequest(TEXT("/api/forge"), TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(SerializeJson(Body.ToSharedRef()));

	Request->OnProcessRequestComplete().BindLambda(
		[OnComplete](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
		{
			FForgeJobResult Result;
			if (!bConnectedSuccessfully || !Response.IsValid())
			{
				Result.Error = TEXT("submit failed: no response from server");
				OnComplete(Result);
				return;
			}
			TSharedPtr<FJsonObject> Data = ParseJsonOrEmpty(Response->GetContentAsString());
			if (!EHttpResponseCodes::IsOk(Response->GetResponseCode()))
			{
				FString Message;
				if (!Data->TryGetStringField(TEXT("message"), Message))
				{
					Message = FString::Printf(TEXT("submit failed with HTTP %d"), Response->GetResponseCode());
				}
				Result.Error = Message;
				OnComplete(Result);
				return;
			}
			FString ErrorField;
			if (Data->TryGetStringField(TEXT("error"), ErrorField))
			{
				FString Message;
				Result.Error = Data->TryGetStringField(TEXT("message"), Message) ? Message : ErrorField;
				OnComplete(Result);
				return;
			}
			Result.bOk = true;
			Data->TryGetStringField(TEXT("job_id"), Result.JobId);
			if (!Data->TryGetStringField(TEXT("status"), Result.Status))
			{
				Result.Status = TEXT("queued");
			}
			Data->TryGetStringField(TEXT("glb_url"), Result.GlbUrl);
			Data->TryGetStringField(TEXT("backend"), Result.Backend);
			OnComplete(Result);
		});
	Request->ProcessRequest();
}

void FThreeWsClient::WaitForGlb(const FString& JobId, float TimeoutSeconds, TFunction<void(FForgeJobResult)> OnComplete)
{
	struct FPollState
	{
		double StartedSeconds = FPlatformTime::Seconds();
		bool bRequestInFlight = false;
		bool bDone = false;
	};
	TSharedRef<FPollState> State = MakeShared<FPollState>();
	TWeakPtr<FThreeWsClient> WeakThis = AsShared();

	FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda(
		[WeakThis, JobId, TimeoutSeconds, OnComplete, State](float) -> bool
		{
			TSharedPtr<FThreeWsClient> PinnedThis = WeakThis.Pin();
			if (!PinnedThis.IsValid() || State->bDone)
			{
				return false;
			}
			if (State->bRequestInFlight)
			{
				return true;
			}
			State->bRequestInFlight = true;

			TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = PinnedThis->BuildRequest(
				FString::Printf(TEXT("/api/forge?job=%s"), *FGenericPlatformHttp::UrlEncode(JobId)), TEXT("GET"));
			Request->OnProcessRequestComplete().BindLambda(
				[JobId, OnComplete, State](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
				{
					State->bRequestInFlight = false;
					if (State->bDone)
					{
						return;
					}
					if (!bConnectedSuccessfully || !Response.IsValid())
					{
						FForgeJobResult Result;
						Result.JobId = JobId;
						Result.Error = TEXT("poll failed: no response from server");
						State->bDone = true;
						OnComplete(Result);
						return;
					}
					TSharedPtr<FJsonObject> Data = ParseJsonOrEmpty(Response->GetContentAsString());
					FString Status;
					if (!Data->TryGetStringField(TEXT("status"), Status))
					{
						Status = TEXT("running");
					}
					FString GlbUrl;
					if (Status == TEXT("done") && Data->TryGetStringField(TEXT("glb_url"), GlbUrl))
					{
						FForgeJobResult Result;
						Result.bOk = true;
						Result.JobId = JobId;
						Result.Status = Status;
						Result.GlbUrl = GlbUrl;
						Data->TryGetStringField(TEXT("backend"), Result.Backend);
						State->bDone = true;
						OnComplete(Result);
						return;
					}
					if (Status == TEXT("failed"))
					{
						FForgeJobResult Result;
						Result.JobId = JobId;
						FString ErrorMessage;
						Result.Error = Data->TryGetStringField(TEXT("error"), ErrorMessage) ? ErrorMessage : TEXT("Generation failed.");
						State->bDone = true;
						OnComplete(Result);
						return;
					}
					// Still running: the ticker keeps polling until done,
					// failed, or timeout.
				});
			Request->ProcessRequest();

			const double Elapsed = FPlatformTime::Seconds() - State->StartedSeconds;
			if (Elapsed > TimeoutSeconds)
			{
				if (!State->bDone)
				{
					FForgeJobResult Result;
					Result.JobId = JobId;
					Result.Error = FString::Printf(TEXT("generation %s timed out after %ds"), *JobId, (int32)TimeoutSeconds);
					State->bDone = true;
					OnComplete(Result);
				}
				return false;
			}
			return true;
		}), PollIntervalSeconds);
}

void FThreeWsClient::DownloadGlb(const FString& Url, const FString& DestinationPath,
	TFunction<void(FForgeDownloadResult)> OnComplete)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(TEXT("GET"));
	Request->SetHeader(TEXT("User-Agent"), TEXT("three-ws-unreal-bridge/") + BridgeVersion);

	Request->OnProcessRequestComplete().BindLambda(
		[DestinationPath, OnComplete](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
		{
			FForgeDownloadResult Result;
			Result.FilePath = DestinationPath;
			if (!bConnectedSuccessfully || !Response.IsValid() || !EHttpResponseCodes::IsOk(Response->GetResponseCode()))
			{
				const int32 Code = Response.IsValid() ? Response->GetResponseCode() : 0;
				Result.Error = FString::Printf(TEXT("downloading the GLB failed with HTTP %d"), Code);
				OnComplete(Result);
				return;
			}
			const TArray<uint8>& Content = Response->GetContent();
			if (!FFileHelper::SaveArrayToFile(Content, *DestinationPath))
			{
				Result.Error = FString::Printf(TEXT("could not write %s to disk"), *DestinationPath);
				OnComplete(Result);
				return;
			}
			Result.bOk = true;
			Result.Bytes = Content.Num();
			OnComplete(Result);
		});
	Request->ProcessRequest();
}
